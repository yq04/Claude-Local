import {expect, test} from 'bun:test';

async function withPrivacyModel(name: string, invoke: (command:string,args:any)=>unknown, run:(model:any)=>Promise<void>) {
  const global = globalThis as unknown as {window?:unknown};
  const previous = global.window;
  const values = new Map([['claude-local.preferences.v1', JSON.stringify({privacyMask:false})]]);
  global.window = {localStorage:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)},__TAURI_INTERNALS__:{invoke}};
  try {
    const moduleName = './settings-model' + '?privacy-' + name;
    await run(await import(moduleName));
  } finally {
    if (previous === undefined) delete global.window;
    else global.window = previous;
  }
}

test('native privacy masks startup until a confirmed stored preference arrives', async () => {
  let release!: (value:boolean)=>void;
  let markStarted!:()=>void;
  const started=new Promise<void>(resolve=>{markStarted=resolve;});
  await withPrivacyModel('startup', command => command === 'ui_privacy_read' ? new Promise<boolean>(resolve => {release=resolve;markStarted();}) : undefined, async model => {
    expect(model.getPreferences().privacyMask).toBe(true);
    const initialized = model.initializePrivacyPreference();
    await started;
    expect(model.getPreferences().privacyMask).toBe(true);
    release(false);
    await initialized;
    expect(model.getPreferences().privacyMask).toBe(false);
  });
});

test('queued privacy writes cannot let an older disable reveal a newer masked preference', async () => {
  let releaseOff!:()=>void, releaseOn!:()=>void, offStarted!:()=>void, onStarted!:()=>void;
  const startedOff=new Promise<void>(resolve=>{offStarted=resolve;});
  const startedOn=new Promise<void>(resolve=>{onStarted=resolve;});
  await withPrivacyModel('ordering', (_command,args) => new Promise<void>(resolve=>{
    if(args.masked){releaseOn=resolve;onStarted();}else{releaseOff=resolve;offStarted();}
  }), async model => {
    const off=model.synchronizePrivacyPreference(false);
    await startedOff;
    const on=model.synchronizePrivacyPreference(true);
    releaseOff();
    await off;
    await startedOn;
    expect(model.getPreferences().privacyMask).toBe(true);
    releaseOn();
    await on;
    model.resetPreferences();
    expect(model.getPreferences().privacyMask).toBe(true);
  });
});

test('privacy persistence failure keeps masking', async () => {
  await withPrivacyModel('failure', ()=>Promise.reject(new Error('synthetic save failure')), async model => {
    await model.synchronizePrivacyPreference(false);
    expect(model.getPreferences().privacyMask).toBe(true);
  });
});
