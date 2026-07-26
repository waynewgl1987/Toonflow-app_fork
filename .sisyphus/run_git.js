const cp = require('child_process');
const cwd = 'E:/AI/Toonflow-app';

try {
  console.log('=== GIT STATUS ===');
  const status = cp.execSync('git status --short', { cwd, encoding: 'utf8', timeout: 10000 });
  console.log(status || '(clean)');

  console.log('\n=== GIT DIFF for key files ===');
  const diff = cp.execSync('git diff HEAD -- src/app.ts data/web/index.html start-toonflow.bat', { cwd, encoding: 'utf8', timeout: 10000 });
  console.log(diff || '(no diff)');

  console.log('\n=== GIT LOG ===');
  const log = cp.execSync('git log --oneline -5', { cwd, encoding: 'utf8', timeout: 10000 });
  console.log(log);

  console.log('\n=== GIT SHOW: index.html size in HEAD ===');
  const size = cp.execSync('git show HEAD:data/web/index.html | wc -c', { cwd, encoding: 'utf8', timeout: 10000, shell: true });
  console.log('HEAD index.html size:', size.trim(), 'bytes');
} catch(e) {
  console.error('ERROR:', e.message);
  if (e.stdout) console.log('STDOUT:', e.stdout.toString());
  if (e.stderr) console.log('STDERR:', e.stderr.toString());
}
