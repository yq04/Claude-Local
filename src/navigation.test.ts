import {expect,test} from 'bun:test';
import {validPage,readPage} from './navigation';

test('navigation accepts only known pages and defaults safely without browser storage',()=>{
  for(const page of ['quick','cleaner','browser','system','vps','help'])expect(validPage(page)).toBe(true);
  for(const page of [null,undefined,'https://example.invalid','../browser','constructor','',1,{}])expect(validPage(page)).toBe(false);
  expect(readPage()).toBe('cleaner');
});
