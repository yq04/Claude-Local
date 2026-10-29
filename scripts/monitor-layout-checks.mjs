// [INPUT]: Existing isolated fictional IPC page and local-only preview server.
// [OUTPUT]: Focused bilingual/light/dark three-size HUD layout assertions and screenshots.
// [POS]: test-local-shell.mjs --monitor-only helper; no native IPC, user data or external requests.
// [PROTOCOL]: Update scripts/CLAUDE.md with changes.
import assert from 'node:assert/strict';
import {join} from 'node:path';

export async function checkMonitorLayouts(page,base,output){
  const results=[];
  for(const language of ['zh','en'])for(const theme of ['light','dark']){
    await page.setViewportSize({width:340,height:258});
    await page.goto(base+'/__local-preview.html?window=monitor');
    await page.locator('.monitor-usage-value').first().filter({hasText:'149k'}).waitFor();
    await page.evaluate(async({language,theme})=>{
      const i18n=await import('/src/i18n.ts');i18n.setLocale(language);
      const prefs=await import('/src/settings-model.ts');prefs.updatePreferences({theme,backdrop:'aurora'});
    },{language,theme});
    for(const mode of ['expanded','compact','collapsed']){
      if(mode==='compact'){
        await page.locator('.monitor-hud-controls button').nth(5).click();
        await page.setViewportSize({width:340,height:152});
        await page.locator('.monitor-hud-shell[data-compact="true"]').waitFor();
      }
      if(mode==='collapsed'){
        await page.locator('.monitor-hud-controls button').nth(2).click();
        await page.setViewportSize({width:52,height:138});
        await page.locator('.monitor-hud-shell.is-collapsed').waitFor();
      }
      const geometry=await page.locator('.monitor-hud-shell').evaluate(shell=>{
        const box=shell.getBoundingClientRect();
        const selectors='.monitor-hud-header,.monitor-hud-account-row,.monitor-limit-window,.monitor-session-strip,.monitor-token-legend,.monitor-usage-tile,.monitor-hud-compact-footer,.monitor-collapsed-pill';
        const outside=[...shell.querySelectorAll(selectors)].filter(node=>{
          const r=node.getBoundingClientRect();return r.left<box.left-0.5||r.right>box.right+0.5||r.bottom>box.bottom+0.5;
        }).map(node=>node.className);
        const clipped=[...shell.querySelectorAll('.monitor-usage-label,.monitor-usage-value,.monitor-token-part-label,.monitor-limit-pct,.monitor-compact-velocity')]
          .filter(node=>node.scrollWidth>node.clientWidth+1).map(node=>node.textContent);
        return {width:box.width,height:box.height,scrollWidth:shell.scrollWidth,clientWidth:shell.clientWidth,outside,clipped};
      });
      assert.deepEqual(geometry.outside,[],`${language}/${theme}/${mode}: content outside window`);
      assert.deepEqual(geometry.clipped,[],`${language}/${theme}/${mode}: clipped metric text`);
      assert.ok(geometry.scrollWidth<=geometry.clientWidth,`${language}/${theme}/${mode}: horizontal overflow`);
      assert.equal(await page.locator('.monitor-hud-shell').getByText(/\$|USD|200k/).count(),0);
      await page.screenshot({path:join(output,`monitor-${language}-${theme}-${mode}.png`)});
      results.push({language,theme,mode,geometry});
    }
  }
  // An unresolved account is different from a confirmed account with zero tokens.
  await page.setViewportSize({width:340,height:258});
  await page.goto(base+'/__local-preview.html?window=monitor');
  await page.locator('.monitor-usage-value').first().filter({hasText:'149k'}).waitFor();
  await page.evaluate(()=>{window.__monitorUsageAvailable=false;});
  await page.locator('.monitor-hud-controls button').nth(6).click();
  await page.getByText('当前账号用量未确认',{exact:true}).waitFor();
  assert.deepEqual(await page.locator('.monitor-usage-value').allTextContents(),['—','—','—']);
  return results;
}
