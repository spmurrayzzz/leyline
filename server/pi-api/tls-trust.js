import { X509Certificate } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { getCACertificates, rootCertificates, setDefaultCACertificates } from 'node:tls'
import { readBackendSettings, writeBackendSettings } from '../backend-connections.js'
import {
  TLS_EXTRA_CA_FILE_SETTING_KEY,
  TLS_EXTRA_CA_FILES_SETTING_KEY,
  TLS_USE_SYSTEM_CA_SETTING_KEY,
} from '../../lib/leyline-settings.js'
import { isSettingsObject, settingsError } from './pi-config.js'

const MAX_CA_FILE_BYTES = 1024 * 1024
const MAX_CA_FILES = 32
const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g

const startupUsesSystemCa = process.execArgv.some(
  (arg) => arg === '--use-system-ca' || arg.startsWith('--use-system-ca='),
) || /(^|\s)--use-system-ca(\s|$)/.test(process.env.NODE_OPTIONS || '')
  || ['1', 'true'].includes(String(process.env.NODE_USE_SYSTEM_CA || '').toLowerCase())

function readCertificates(kind) {
  try {
    return getCACertificates(kind) || []
  } catch {
    return []
  }
}

function systemStoreAvailable() {
  try {
    getCACertificates('system')
    return true
  } catch {
    return false
  }
}

const bundledCertificates = [...rootCertificates]
const environmentCertificates = readCertificates('extra')

function addCertificate(store, pem) {
  const value = String(pem).replace(/\r\n/g, '\n').trim()
  if (value) store.add(value)
}

function parseStoredFiles(value) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
      : []
  } catch {
    return []
  }
}

function readSettings() {
  const values = readBackendSettings([
    TLS_EXTRA_CA_FILES_SETTING_KEY,
    TLS_EXTRA_CA_FILE_SETTING_KEY,
    TLS_USE_SYSTEM_CA_SETTING_KEY,
  ])
  const stored = parseStoredFiles(values[TLS_EXTRA_CA_FILES_SETTING_KEY])
  const legacy = values[TLS_EXTRA_CA_FILE_SETTING_KEY] || ''
  const storedSystem = values[TLS_USE_SYSTEM_CA_SETTING_KEY]
  return {
    extraCaFiles: stored.length ? stored : legacy ? [legacy] : [],
    useSystemCa: storedSystem === 'true' || (storedSystem === '' && startupUsesSystemCa),
  }
}

function normalizeCaFile(value) {
  if (typeof value !== 'string') throw settingsError('CA certificate path must be text.')
  const text = value.trim()
  if (!text) throw settingsError('CA certificate path cannot be empty.')
  if (text.length > 4096) throw settingsError('CA certificate path is too long.')
  const path = text === '~'
    ? homedir()
    : text.startsWith('~/') ? join(homedir(), text.slice(2)) : text
  if (!isAbsolute(path)) throw settingsError('Use an absolute path for the CA certificate file.')
  return path
}

function readCaFile(path) {
  let info
  try {
    info = statSync(path)
  } catch (error) {
    throw settingsError(`Could not read the CA certificate file: ${error.message}`)
  }
  if (!info.isFile()) throw settingsError('The CA certificate path is not a file.')
  if (info.size > MAX_CA_FILE_BYTES) throw settingsError('The CA certificate file is larger than 1 MB.')
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw settingsError(`Could not read the CA certificate file: ${error.message}`)
  }
  const found = text.match(PEM_CERTIFICATE) || []
  if (/-----(?:BEGIN|END) CERTIFICATE-----/.test(text.replace(PEM_CERTIFICATE, ''))) {
    throw settingsError('The CA certificate file contains an incomplete PEM certificate.')
  }
  if (!found.length) throw settingsError('The CA certificate file does not contain a PEM certificate.')
  for (const pem of found) {
    try {
      new X509Certificate(pem)
    } catch {
      throw settingsError('The CA certificate file contains an invalid certificate.')
    }
  }
  return found
}

function inspectCaFile(path) {
  try {
    const certificates = readCaFile(path)
    return {
      path,
      name: basename(path),
      certificateCount: certificates.length,
      error: '',
      certificates,
    }
  } catch (error) {
    return {
      path,
      name: basename(path),
      certificateCount: 0,
      error: error.message,
      certificates: [],
    }
  }
}

function publicFile({ certificates: _certificates, ...file }) {
  return file
}

export function buildTrustStore(settings = readSettings()) {
  const merged = new Set()
  for (const cert of bundledCertificates) addCertificate(merged, cert)
  for (const cert of environmentCertificates) addCertificate(merged, cert)
  if (settings.useSystemCa) {
    for (const cert of readCertificates('system')) addCertificate(merged, cert)
  }
  const files = settings.extraCaFiles.map(inspectCaFile)
  for (const file of files) {
    for (const cert of file.certificates) addCertificate(merged, cert)
  }
  const customCount = files.reduce((sum, file) => sum + file.certificateCount, 0)
  const error = files.map((file) => file.error).filter(Boolean).join(' ')
  return { certificates: [...merged], files: files.map(publicFile), customCount, error }
}

export function applyTlsTrust(settings = readSettings()) {
  if (typeof setDefaultCACertificates !== 'function') {
    return { count: 0, files: [], customCount: 0, error: '' }
  }
  const store = buildTrustStore(settings)
  try {
    setDefaultCACertificates(store.certificates)
  } catch (failure) {
    return { count: 0, files: store.files, customCount: store.customCount, error: failure.message }
  }
  return {
    count: store.certificates.length,
    files: store.files,
    customCount: store.customCount,
    error: store.error,
  }
}

export function applyTlsTrustAtStartup() {
  const settings = readSettings()
  const applied = applyTlsTrust(settings)
  if (settings.extraCaFiles.length || settings.useSystemCa || process.env.NODE_EXTRA_CA_CERTS) {
    console.log(`TLS trust: ${applied.count} CA certificates active`)
  }
  if (applied.error) console.error('Could not apply saved TLS certificate settings:', applied.error)
}

export function getTlsTrustSettings() {
  const settings = readSettings()
  const store = buildTrustStore(settings)
  return {
    extraCaFiles: store.files,
    useSystemCa: settings.useSystemCa,
    envCaFile: process.env.NODE_EXTRA_CA_CERTS || '',
    envCaCount: environmentCertificates.length,
    systemAvailable: systemStoreAvailable(),
    bundledCount: bundledCertificates.length,
    systemCount: readCertificates('system').length,
    customCount: store.customCount,
    appliedCount: store.certificates.length,
    error: store.error,
  }
}

export function setTlsTrustSettings(input) {
  if (!isSettingsObject(input)
    || Object.keys(input).some((key) => !['extraCaFiles', 'useSystemCa'].includes(key))
    || typeof input.useSystemCa !== 'boolean'
    || !Array.isArray(input.extraCaFiles)) {
    throw settingsError('Provide CA certificate files and the system store preference.')
  }
  if (input.extraCaFiles.length > MAX_CA_FILES) {
    throw settingsError(`Use at most ${MAX_CA_FILES} CA certificate files.`)
  }
  const paths = []
  for (const value of input.extraCaFiles) {
    const path = normalizeCaFile(value)
    if (paths.includes(path)) throw settingsError('Each CA certificate file can only be added once.')
    readCaFile(path)
    paths.push(path)
  }
  if (typeof setDefaultCACertificates !== 'function') {
    throw settingsError('This runtime cannot change the default CA certificates.')
  }
  const store = buildTrustStore({ extraCaFiles: paths, useSystemCa: input.useSystemCa })
  if (store.error) throw settingsError(store.error)
  const previousCertificates = getCACertificates('default')
  try {
    setDefaultCACertificates(store.certificates)
  } catch (error) {
    throw settingsError(`Could not apply the CA certificate settings: ${error.message}`)
  }
  try {
    writeBackendSettings({
      [TLS_EXTRA_CA_FILES_SETTING_KEY]: JSON.stringify(paths),
      [TLS_EXTRA_CA_FILE_SETTING_KEY]: '',
      [TLS_USE_SYSTEM_CA_SETTING_KEY]: String(input.useSystemCa),
    })
  } catch (error) {
    setDefaultCACertificates(previousCertificates)
    throw error
  }
  return getTlsTrustSettings()
}
