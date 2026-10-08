// Build a signed, dependency-free Android APK with official SDK tools.
// Signing material stays outside this source tree and is never printed.
import {existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync} from 'node:fs';
import {resolve, dirname, join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomBytes, createHash} from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const version = option('--version', '1.0.0');
const versionCode = option('--code', '1');
if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[1-9]\d{0,7}$/.test(versionCode)) throw Error('Invalid version/code');
const toolsRoot = resolve(option('--tools', join(root, '.workbench/android-tools')));
const javaHome = process.env.YUZHOU_JAVA_HOME || process.env.JAVA_HOME;
if (!javaHome) throw Error('Set JAVA_HOME or YUZHOU_JAVA_HOME to an installed JDK.');
const exe = name => join(javaHome, 'bin', `${name}.exe`);
function find(directory, name) {
  if (!existsSync(directory)) return undefined;
  for (const item of readdirSync(directory, {withFileTypes:true})) {
    const path = join(directory, item.name);
    if (item.isFile() && item.name === name) return path;
    if (item.isDirectory()) { const result = find(path, name); if (result) return result; }
  }
}
const tool = name => { const path = find(toolsRoot, name); if (!path) throw Error(`Missing Android SDK tool: ${name}`); return path; };
const androidJar = tool('android.jar'), aapt2 = tool('aapt2.exe'), zipalign = tool('zipalign.exe');
const d8 = tool('d8.jar'), signer = tool('apksigner.jar');
const run = (command, parameters, extra = {}) => {
  // Windows aapt2 expects narrow paths. Relative project paths also support a
  // Chinese-named checkout without moving or renaming the user's workspace.
  const portable = parameters.map(value => value.startsWith(root + sep) ? relative(root,value) : value);
  const result = spawnSync(command, portable, {cwd:root, encoding:'utf8', maxBuffer:8*1024*1024, ...extra});
  if (result.status !== 0) throw Error(`${command.split(/[\\/]/).pop()} failed (${result.status}):\n${result.stderr || result.stdout || result.error}`);
  return result.stdout;
};
const source = join(root, 'mobile/android/app/src/main');
const id = `${version}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const build = join(root, '.workbench/android-build', id);
mkdirSync(build, {recursive:true});
for (const child of ['generated','classes','dex']) mkdirSync(join(build, child));
const resources = join(build, 'resources.zip'), unsigned = join(build, 'unsigned.apk');
run(aapt2, ['compile','--dir',join(source,'res'),'-o',resources]);
run(aapt2, ['link','-o',unsigned,'-I',androidJar,'--manifest',join(source,'AndroidManifest.xml'),'-R',resources,'--java',join(build,'generated'),'-A',join(source,'assets'),'--min-sdk-version','26','--target-sdk-version','35','--version-code',versionCode,'--version-name',version,'--auto-add-overlay']);
const generatedPackage = join(build,'generated/cn/yuzhou/workbench');
mkdirSync(generatedPackage,{recursive:true});
writeFileSync(join(generatedPackage,'BuildConfig.java'),`package cn.yuzhou.workbench; public final class BuildConfig { public static final boolean DEBUG = false; public static final String VERSION_NAME = "${version}"; public static final int VERSION_CODE = ${versionCode}; }\n`);
const javaFiles = directory => readdirSync(directory,{withFileTypes:true}).flatMap(item => item.isDirectory() ? javaFiles(join(directory,item.name)) : item.name.endsWith('.java') ? [join(directory,item.name)] : []);
const sources = [...javaFiles(join(source,'java')),...javaFiles(join(build,'generated'))];
run(exe('javac'), ['--release','8','-encoding','UTF-8','-classpath',androidJar,'-d',join(build,'classes'),...sources]);
const classes = join(build, 'classes.jar');
run(exe('jar'), ['--create','--file',classes,'-C',join(build,'classes'),'.']);
run(exe('java'), ['-cp',d8,'com.android.tools.r8.D8','--release','--lib',androidJar,'--min-api','26','--output',join(build,'dex'),classes]);
const dexFiles = readdirSync(join(build,'dex')).filter(name => name.endsWith('.dex'));
for (const file of dexFiles) run(exe('jar'), ['--update','--file',unsigned,'-C',join(build,'dex'),file]);
const aligned = join(build,'aligned.apk');
run(zipalign, ['-f','-p','4',unsigned,aligned]);

const signing = resolve(option('--signing-dir', 'E:/服务器秘钥/宇宙安卓签名'));
const keystore = join(signing,'yuzhou-release.p12'), password = join(signing,'keystore-password.txt');
if (existsSync(keystore) !== existsSync(password)) throw Error('Incomplete signing directory: preserve its files and repair before continuing.');
if (!existsSync(keystore)) {
  mkdirSync(signing,{recursive:true});
  const principal = run('whoami.exe',[]).trim();
  run('icacls.exe',[signing,'/inheritance:r','/grant:r',`${principal}:(OI)(CI)F`,'SYSTEM:(OI)(CI)F']);
  const secret = randomBytes(36).toString('base64url');
  writeFileSync(password,secret,{flag:'wx',mode:0o600});
  run(exe('keytool'),['-genkeypair','-keystore',keystore,'-storetype','PKCS12','-storepass:env','YUZHOU_ANDROID_STORE_PASS','-keypass:env','YUZHOU_ANDROID_STORE_PASS','-alias','yuzhou','-keyalg','RSA','-keysize','3072','-sigalg','SHA256withRSA','-validity','10950','-dname','CN=Yuzhou Personal Workbench, O=Personal, C=CN'],{env:{...process.env,YUZHOU_ANDROID_STORE_PASS:secret}});
}
const output = join(root,'mobile/releases',`yuzhou-android-${id}.apk`);
if (existsSync(output)) throw Error('Release already exists; refusing to overwrite.');
run(exe('java'),['-jar',signer,'sign','--ks',keystore,'--ks-key-alias','yuzhou','--ks-pass',`file:${password}`,'--out',output,aligned]);
const verification = run(exe('java'),['-jar',signer,'verify','--verbose','--print-certs',output]);
if (!verification.includes('Verified using v2 scheme (APK Signature Scheme v2): true')) throw Error('APK v2 signature was not verified.');
run(zipalign,['-c','-p','4',output]);
const sha256 = createHash('sha256').update(readFileSync(output)).digest('hex');
const metadata = {applicationId:'cn.yuzhou.workbench',version,versionCode:Number(versionCode),minSdk:26,targetSdk:35,server:'https://203.195.191.239',apk:output,sha256,bytes:readFileSync(output).length,createdAt:new Date().toISOString(),signerCertificateSha256:verification.match(/Signer #1 certificate SHA-256 digest: (.+)/)?.[1],signatureVerified:true};
writeFileSync(output.replace(/\.apk$/,'.json'),JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(metadata,null,2));
