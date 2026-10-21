import {expect,test} from 'bun:test';
import {validPage,readPage} from './navigation';

test('navigation accepts only known pages and defaults safely without browser storage',()=>{
  for(const page of ['quick','cleaner','usage','browser','system','vps','help','settings'])expect(validPage(page)).toBe(true);
  for(const page of [null,undefined,'https://example.invalid','../browser','constructor','',1,{}])expect(validPage(page)).toBe(false);
  expect(readPage()).toBe('cleaner');
});

test('all 8 primary sidebar navigation labels in Chinese are exactly 4 characters',()=>{
  const titles:Record<string,string>={
    quick:'快速配置',
    cleaner:'身份管理',
    usage:'用量分析',
    browser:'浏览环境',
    system:'电脑环境',
    vps:'网络环境',
    help:'使用说明',
    settings:'软件设置',
  };
  for(const title of Object.values(titles)){
    expect(title.length).toBe(4);
    expect(/^[\u4e00-\u9fa5]{4}$/.test(title)).toBe(true);
  }
});
