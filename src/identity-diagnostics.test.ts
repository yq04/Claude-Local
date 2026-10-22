import {expect, test} from 'bun:test'
import {buildIdentityDiagnostic} from './identity-diagnostics'

test('diagnostic is a strict allowlist and omits missing/future observation numbers', () => {
  const result = buildIdentityDiagnostic({
    version:'0.1.6', generatedAtMs:100_000,
    windows:{'5h':{source:'server_anchor',observedAtMs:40_000},'7d':{source:'unknown',observedAtMs:101_000}},
    setup:{state:'not_configured',collectorBundled:true,hasStatusline:false},
    email:'must-not-appear', accountId:'secret', proxy:'secret', path:'secret', rawcmd:'secret',
  } as never)
  expect(result.windows['5h']).toEqual({source:'server_anchor',observedAtMs:40_000,ageMinutes:1})
  expect(result.windows['7d']).toEqual({source:'unknown',observedAtMs:null,ageMinutes:null})
  expect(result.setup).toEqual({state:'not_configured',collectorBundled:true,hasStatusline:false,runtime:'unverified'})
  expect(JSON.stringify(result)).not.toContain('secret')
  expect(Object.keys(result).sort()).toEqual(['generatedAtMs','setup','version','windows'])
})

test('version field accepts only a bounded semantic version', () => {
  const input={version:'C:/private/path',generatedAtMs:100_000,windows:{'5h':{source:'unknown'},'7d':{source:'unknown'}},setup:null}
  expect(buildIdentityDiagnostic(input).version).toBeNull()
  expect(buildIdentityDiagnostic({...input,version:'0.1.6'}).version).toBe('0.1.6')
})
