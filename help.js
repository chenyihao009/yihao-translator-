(()=>{
  const button=document.querySelector('#open-settings');
  const status=document.querySelector('#settings-status');
  const runtime=globalThis.chrome?.runtime;
  const inExtension=location.protocol==='chrome-extension:'&&Boolean(runtime?.id)&&typeof runtime?.sendMessage==='function';
  if(!button||!status)return;
  button.disabled=!inExtension;
  status.textContent=inExtension
    ?'已在扩展内打开，可直接进入设置。'
    :'当前为离线教程。安装后，可在Chrome扩展管理页的“详情 → 扩展程序选项”进入设置。';
  if(!inExtension)return;
  button.addEventListener('click',async()=>{
    button.disabled=true;
    status.textContent='正在打开扩展设置。';
    try{
      const response=await runtime.sendMessage({type:'openSettings'});
      if(!response?.ok)throw new Error(response?.error||'设置页暂时无法打开。');
      status.textContent='设置页已打开。保存配置后可回到YouTube。';
    }catch(error){
      status.textContent=(error.message||'设置页暂时无法打开。')+' 也可从Chrome扩展管理页的“详情 → 扩展程序选项”进入。';
    }finally{
      button.disabled=false;
    }
  });
})();
