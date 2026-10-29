import {test,expect} from 'bun:test';
import {localGate} from '../src/local-gate';

test('Local opening page preserves the exact supported one-use nonce form',()=>{
 const form='<form method="post" action="/api/auth/nonce"><input name="nonce" type="hidden" value="fixture"><input name="dest" value="/"><button type="submit">Sign in</button></form>';
 const result=localGate('<!DOCTYPE html><title>Sign in — Chimeric</title><svg>old mark</svg>'+form,'en','<svg data-chimeric-dna="true"></svg>');
 expect(result).toContain(form.replace('Sign in','Open local workspace'));expect(result).toContain('data-chimeric-dna');
 expect(result).not.toContain('old mark');expect(result).not.toContain('anthropic');
});
test('A page without a nonce directs users to the local launcher without inventing a login token',()=>{
 const result=localGate('<html><title>Sign in — Chimeric</title><a href="https://claude.ai">Sign in</a></html>','ja','<svg></svg>');
 expect(result).toContain('Chimericアプリ');expect(result).toContain('lang="ja"');expect(result).not.toContain('https://claude.ai');expect(result).not.toContain('<form');
});
test('The original native relative nonce actions survive branding at root and nested routes',()=>{
 for(const action of ['./api/auth/nonce','../../api/auth/nonce']){
  const form='<form method="post" action="'+action+'"><input name="nonce" value="fixture"><button type="submit">Sign in</button></form>';
  const result=localGate('<!doctype html><title>Sign in — Chimeric</title>'+form,'en','<svg/>');
  expect(result).toContain(form.replace('Sign in','Open local workspace'));
 }
 const other='<html><title>Sign in — Chimeric</title><form action="https://other.example/api/auth/nonce"></form></html>';
 expect(localGate(other,'en','<svg/>')).not.toContain('<form');
});
test('Normal app HTML and API JSON pass through the local gate unchanged',()=>{
 const html='<html><title>Chimeric</title><script type="module" src="/assets/main.js"></script></html>';
 expect(localGate(html,'ja','<svg/>')).toBe(html);expect(localGate('{"detail":"Sign in"}','en','<svg/>')).toBe('{"detail":"Sign in"}');
});
