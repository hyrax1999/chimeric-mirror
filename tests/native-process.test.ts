import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {patchDaemonIdentity} from '../tools/native-process';
const body=readFileSync(new URL('./native-daemon-body.js.fragment',import.meta.url),'utf8');
test('The native lifecycle guard recognizes Chimeric and retains its rejection of unrelated processes',()=>{
 const guard=new Function('e','t=false',patchDaemonIdentity(body));
 expect(guard('/Applications/Chimeric.app/Contents/Resources/bin/chimeric /Applications/Chimeric.app/Contents/Resources/runtime/chimeric.js serve --port 18868')).toBe(true);
 expect(guard('/home/user/bin/chimeric /opt/chimeric/chimeric.js serve --port 18868')).toBe(true);
 expect(guard('/opt/claude-science serve --port 8766')).toBe(true);
 expect(guard('/usr/bin/python task.py')).toBe(false);
 expect(guard('/tmp/chimeric-notes serve')).toBe(false);
 expect(guard('/usr/bin/echo chimeric serve')).toBe(false);
 expect(guard('/opt/chimeric status')).toBe(false);
 expect(guard('"C:\\Chimeric\\chimeric.exe"',true)).toBe(true);
});
test('An unknown native process guard fails the build before any lifecycle behavior is patched',()=>{
 expect(()=>patchDaemonIdentity(body+' ')).toThrow('predicate changed');
});
