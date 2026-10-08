import {createApp} from './src/server.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
  if(args[i]==='--port'&&args[i+1])options.port=Number(args[++i]);
  else if(args[i]==='--data-dir'&&args[i+1])options.dataDir=args[++i];
  else throw new Error('仅支持 --port 和 --data-dir。');
}
const app=createApp(options);
try{
  await app.listen();
  console.log('创宇宙独立实例：'+app.runtime.origin);
  console.log('运行目录：'+app.runtime.dataDir);
  if(!app.store.hasAccount())console.log('首次使用请打开运行目录内的 setup-code.txt，在网页设置专用密码。');
}catch(error){app.store.close();console.error(error.code==='EADDRINUSE'?'端口已被占用，请换一个4380至4399的端口；不会停止其他应用。':'创宇宙启动失败，请检查独立运行路径。');process.exitCode=1;}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{app.close().then(()=>process.exit(0));});
