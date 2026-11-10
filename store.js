let opening;
function db() {
  if (!opening) opening = new Promise((resolve,reject) => {
    const request = indexedDB.open('youtube-whole-sentences', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('items');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  return opening;
}
export async function get(key) {
  const database = await db();
  return new Promise((resolve,reject) => {const request = database.transaction('items').objectStore('items').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
}
export async function set(key, value) {
  const database = await db();
  return new Promise((resolve,reject) => {const tx = database.transaction('items','readwrite'); tx.objectStore('items').put(value,key); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);});
}
export async function remove(key){
  const database=await db();
  return new Promise((resolve,reject)=>{const tx=database.transaction('items','readwrite');tx.objectStore('items').delete(key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
}
export async function translationControl(){
  return await get('translation-control')||{enabled:true,epoch:0};
}
