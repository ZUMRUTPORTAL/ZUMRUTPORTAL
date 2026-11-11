/* Zümrüt Portal: Firebase Authentication + Cloud Firestore */
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const $ = id => document.getElementById(id);
const firebaseConfig = {
  apiKey: "AIzaSyBfJxNuC230YYQcRffkDyxcXRO0VxD_BxA",
  authDomain: "zpor-b2549.firebaseapp.com",
  projectId: "zpor-b2549",
  storageBucket: "zpor-b2549.firebasestorage.app",
  messagingSenderId: "649673985347",
  appId: "1:649673985347:web:dfc259c1fd2265907833f6"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
// Personel eklerken adminin ana oturumunu kapatmamak için ayrı Auth nesnesi.
const personelAuth = firebase.initializeApp(firebaseConfig, "personelHesaplari").auth();
auth.languageCode = "tr";
personelAuth.languageCode = "tr";

const Depo = {
  oku(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  yaz(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  sil(k) { localStorage.removeItem(k); }
};
let kullanicilar = [], aktifKullanici = null, aktifKalemler = [], tumFaturalar = {}, urunler = {};
let sesAcik = Depo.oku("zumrut_ses", true);
let html5QrCode = null, kameraAcik = false, fenerAcik = false, kilit = false, sonOkunan = "", sonOkunanZaman = 0, yuklenenUid = "";

function hataMetni(e) {
  const m = {"auth/invalid-credential":"E-posta veya şifre hatalı.","auth/user-not-found":"Bu e-posta için hesap bulunamadı.","auth/wrong-password":"E-posta veya şifre hatalı.","auth/invalid-email":"E-posta adresini kontrol edin.","auth/email-already-in-use":"Bu e-posta zaten kayıtlı.","auth/weak-password":"Şifre en az 6 karakter olmalı.","auth/too-many-requests":"Çok fazla deneme yapıldı. Biraz bekleyip tekrar deneyin.","auth/network-request-failed":"İnternet bağlantısını kontrol edin.","permission-denied":"Firestore güvenlik kuralları veya kullanıcı yetkileri eksik."};
  return m[e && e.code] || (e && e.message) || "İşlem tamamlanamadı.";
}
function girisHatasi(s) { $("loginHata").innerText = s; $("loginHata").style.display = "block"; }
async function girisYap() {
  const email = $("loginEmail").value.trim().toLowerCase(), sifre = $("loginSifre").value;
  if (!email || !sifre) { girisHatasi("E-posta ve şifre girin."); return; }
  try { $("loginHata").style.display = "none"; await auth.signInWithEmailAndPassword(email, sifre); }
  catch (e) { girisHatasi(hataMetni(e)); }
}
async function sifreSifirlamaIste() {
  const email = $("loginEmail").value.trim().toLowerCase();
  if (!email) { girisHatasi("Önce e-posta adresinizi yazın."); return; }
  try { await auth.sendPasswordResetEmail(email); alert("Şifre sıfırlama bağlantısı e-postanıza gönderildi."); }
  catch (e) { girisHatasi(hataMetni(e)); }
}
async function bulutFaturalariYukle() {
  let q = db.collection("invoices");
  if (aktifKullanici.rol !== "admin") q = q.where("ownerUid", "==", aktifKullanici.id);
  const snap = await q.get(); tumFaturalar = {};
  snap.forEach(d => { tumFaturalar[d.id] = Object.assign({id:d.id}, d.data()); });
}
async function bulutVerisiniYukle() {
  if (aktifKullanici.rol === "admin") {
    const p = await db.collection("profiles").get(); kullanicilar = p.docs.map(d => Object.assign({id:d.id}, d.data()));
  } else {
    const p = await db.collection("profiles").doc(aktifKullanici.id).get();
    kullanicilar = p.exists ? [Object.assign({id:p.id}, p.data())] : [];
  }
  const products = await db.collection("products").get(); urunler = {};
  products.forEach(d => { urunler[d.id] = d.data().ad || ""; });
  await bulutFaturalariYukle();
}
async function profileYukle(user) {
  if (yuklenenUid === user.uid && aktifKullanici) return;
  yuklenenUid = user.uid;
  try {
    const snap = await db.collection("profiles").doc(user.uid).get();
    if (!snap.exists || snap.data().active !== true) throw new Error("Bu hesapta etkin portal profili yok. İlk yönetici profilini kurulum kılavuzuna göre oluşturun.");
    const p = snap.data();
    aktifKullanici = {id:user.uid, email:user.email || p.email || "", ad:p.ad || user.email || "Kullanıcı", rol:p.role || "personel"};
    await bulutVerisiniYukle();
    $("loginOverlay").style.display = "none"; $("anaUygulama").style.display = "block";
    $("aktifKullaniciTag").innerText = "👤 " + aktifKullanici.ad; $("personelAd").value = aktifKullanici.ad;
    $("loginSifre").value = ""; $("loginHata").style.display = "none"; sesButonuGuncelle(); await taslakYukle();
    if (aktifKullanici.rol === "admin") { $("adminPaneli").style.display = "block"; faturaListesiGuncelle(); await adminKullaniciTablosuCiz(); urunMetniniDoldur(); }
    else { $("adminPaneli").style.display = "none"; }
    firebaseKaydet();
  } catch (e) {
    yuklenenUid = ""; aktifKullanici = null; girisHatasi(hataMetni(e)); await auth.signOut();
  }
}
auth.onAuthStateChanged(user => {
  if (user) profileYukle(user);
  else { canliDinleyicileriKapat(); yuklenenUid=""; aktifKullanici=null; kullanicilar=[]; tumFaturalar={}; urunler={}; aktifKalemler=[]; $("anaUygulama").style.display="none"; $("loginOverlay").style.display="flex"; }
});
async function cikisYap() { await kameraKapat(); await auth.signOut(); }

let canliAbonelikler = [], kayitsizlar = [], kayitsizQr = null, kayitsizFotoData = "";
function canliDinleyicileriKapat() { canliAbonelikler.forEach(unsub => { try { unsub(); } catch(e) {} }); canliAbonelikler=[]; }
function firebaseKaydet() {
  if (!aktifKullanici) return;
  canliDinleyicileriKapat();
  $("bulutDurum").innerText = "Firestore canlı eşitlemesi bağlı. Değişiklikler diğer cihazlara aktarılıyor.";
  const p = db.collection("products").onSnapshot(s => {
    urunler={}; s.forEach(d => { urunler[d.id]=d.data().ad||""; });
    if (aktifKullanici && aktifKullanici.rol==="admin" && document.activeElement !== $("urunMetin")) urunMetniniDoldur();
    tabloCiz();
  }, e => { $("bulutDurum").innerText="Ürün eşitleme hatası: "+hataMetni(e); });
  let iq=db.collection("invoices"); if(aktifKullanici.rol!=="admin") iq=iq.where("ownerUid","==",aktifKullanici.id);
  const i=iq.onSnapshot(s => {
    tumFaturalar={}; s.forEach(d=>{tumFaturalar[d.id]=Object.assign({id:d.id},d.data());});
    if(aktifKullanici && aktifKullanici.rol==="admin") faturaListesiGuncelle();
  },e=>{ $("bulutDurum").innerText="Fatura eşitleme hatası: "+hataMetni(e); });
  canliAbonelikler.push(p,i);
  if(aktifKullanici.rol==="admin") {
    const u=db.collection("profiles").onSnapshot(s=>{
      kullanicilar=s.docs.map(d=>Object.assign({id:d.id},d.data()));
      const me=kullanicilar.find(x=>x.id===aktifKullanici.id);
      if(!me || me.active!==true){auth.signOut();return;}
      if(me.ad && me.ad!==aktifKullanici.ad){aktifKullanici.ad=me.ad;$("aktifKullaniciTag").innerText="👤 "+me.ad;$("personelAd").value=me.ad;}
      adminKullaniciTablosuCiz();
    },e=>{ $("bulutDurum").innerText="Kullanıcı eşitleme hatası: "+hataMetni(e); });
    const k=db.collection("unlisted").orderBy("createdAt","desc").onSnapshot(s=>{
      kayitsizlar=s.docs.map(d=>Object.assign({id:d.id},d.data())); kayitsizlariCiz();
    },e=>{ $("bulutDurum").innerText="Bildirim eşitleme hatası: "+hataMetni(e); });
    canliAbonelikler.push(u,k);
  }
}

function adminSekmeDegis(t) {
  ["faturalar","kayitsiz","kullanicilar","urunler","bulut"].forEach(x => {
    $("adminSekme"+x[0].toUpperCase()+x.slice(1)).style.display = x===t ? "block" : "none";
    $("btnTab"+x[0].toUpperCase()+x.slice(1)).className = x===t ? "active" : "";
  });
}

function kayitsizlariCiz() {
  if(!$("kayitsizUrunListesi"))return;
  $("kayitsizSayacBadge").innerText=kayitsizlar.length;
  if(!kayitsizlar.length){$("kayitsizUrunListesi").innerHTML='<div class="not">Bekleyen ürün bildirimi yok.</div>';return;}
  $("kayitsizUrunListesi").innerHTML=kayitsizlar.map(x=>{
    const img=typeof x.fotoBase64==="string"&&x.fotoBase64.startsWith("data:image/")?'<img class="kayitsiz-thumb" src="'+esc(x.fotoBase64)+'" alt="Ürün fotoğrafı">':'';
    return '<div class="kayitsiz-item">'+img+'<div style="flex:1"><b>'+esc(x.barkod||"")+'</b><div>'+esc(x.not||"Ürün adı girilmemiş")+'</div><div class="not">Bildiren: '+esc(x.personel||"")+' · '+esc(x.tarih||"")+'</div><button class="btn-del" style="background:#16a34a" onclick="kayitsizUrunuEkle(\''+esc(x.id)+'\')">Ürün listesine ekle</button> <button class="btn-del" onclick="kayitsizSil(\''+esc(x.id)+'\')">Sil</button></div></div>';
  }).join("");
}
function kayitsizModalAc(){kayitsizFotoData="";$("kayitsizBarkod").value="";$("kayitsizNot").value="";$("kayitsizFoto").value="";$("fotoOnizlemeAlani").style.display="none";$("kayitsizModal").style.display="flex";}
async function kayitsizModalKapat(){if(kayitsizQr){try{await kayitsizQr.stop();kayitsizQr.clear();}catch(e){}kayitsizQr=null;}$("kayitsizReader").style.display="none";$("kayitsizModal").style.display="none";}
function fotoSecildi(input){const f=input.files&&input.files[0];if(!f)return;if(!f.type.startsWith("image/")){alert("Lütfen resim dosyası seçin.");return;}const r=new FileReader();r.onload=()=>{kayitsizFotoData=String(r.result||"");$("kayitsizFotoOnizleme").src=kayitsizFotoData;$("fotoOnizlemeAlani").style.display="block";};r.readAsDataURL(f);}
async function fotoKucult(data){if(!data)return "";return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{const scale=Math.min(1,600/Math.max(im.width,im.height)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(im.width*scale));c.height=Math.max(1,Math.round(im.height*scale));c.getContext("2d").drawImage(im,0,0,c.width,c.height);resolve(c.toDataURL("image/jpeg",0.55));};im.onerror=reject;im.src=data;});}
async function kayitsizBarkodKameraBaslat(){try{$("kayitsizReader").style.display="block";if(kayitsizQr){await kayitsizQr.stop();kayitsizQr.clear();}kayitsizQr=new Html5Qrcode("kayitsizReader");await kayitsizQr.start({facingMode:"environment"},{fps:10,qrbox:{width:240,height:120}},async text=>{$("kayitsizBarkod").value=text;if(kayitsizQr){try{await kayitsizQr.stop();kayitsizQr.clear();}catch(e){}kayitsizQr=null;}$("kayitsizReader").style.display="none";});}catch(e){alert("Barkod kamerası açılamadı: "+e);}}
async function kayitsizUrunGonder(){const barkod=$("kayitsizBarkod").value.trim(),aciklama=$("kayitsizNot").value.trim();if(!aktifKullanici){alert("Önce giriş yapın.");return;}if(!barkod){alert("Barkod girin veya okutun.");return;}try{const foto=await fotoKucult(kayitsizFotoData);if(foto.length>850000){alert("Fotoğraf çok büyük. Daha küçük bir fotoğraf seçin.");return;}await db.collection("unlisted").add({barkod,not:aciklama,fotoBase64:foto,ownerUid:aktifKullanici.id,personel:aktifKullanici.ad,tarih:new Date().toLocaleString("tr-TR"),createdAt:firebase.firestore.FieldValue.serverTimestamp()});await kayitsizModalKapat();alert("Ürün bildirimi yöneticiye gönderildi.");}catch(e){alert("Bildirim gönderilemedi: "+hataMetni(e));}}
async function kayitsizUrunuEkle(id){if(aktifKullanici?.rol!=="admin")return;const x=kayitsizlar.find(a=>a.id===id);if(!x)return;const ad=x.not||prompt(x.barkod+" için ürün adı:");if(!ad)return;try{await db.collection("products").doc(x.barkod).set({ad:ad.trim(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});await db.collection("unlisted").doc(id).delete();}catch(e){alert("Ürün eklenemedi: "+hataMetni(e));}}
async function kayitsizSil(id){if(aktifKullanici?.rol!=="admin"||!confirm("Bu ürün bildirimi silinsin mi?"))return;try{await db.collection("unlisted").doc(id).delete();}catch(e){alert(hataMetni(e));}}
async function tumKayitsizlariTemizle(){if(aktifKullanici?.rol!=="admin"||!kayitsizlar.length||!confirm("Tüm ürün bildirimleri silinsin mi?"))return;try{let b=db.batch(),n=0;for(const x of kayitsizlar){b.delete(db.collection("unlisted").doc(x.id));if(++n===400){await b.commit();b=db.batch();n=0;}}if(n)await b.commit();}catch(e){alert(hataMetni(e));}}
async function adminKullaniciTablosuCiz() {
  if (!aktifKullanici || aktifKullanici.rol !== "admin") return;
  const snap = await db.collection("profiles").get(); kullanicilar = snap.docs.map(d => Object.assign({id:d.id}, d.data()));
  $("kullaniciTablosu").innerHTML = kullanicilar.map(u =>
    '<tr><td><b>'+esc(u.ad)+'</b>'+(u.active===false?'<span class="urun-ad"> (Erişim kapalı)</span>':'')+'</td><td>'+esc(u.email)+'</td><td><span class="badge">'+esc(String(u.role||"personel").toUpperCase())+'</span></td><td>'+
    '<button class="btn-del" style="background:#475569" onclick="personelAdiDegistir(\''+esc(u.id)+'\')">Adı Değiştir</button> '+
    '<button class="btn-del" style="background:#d97706" onclick="sifreSifirlamaGonder(\''+esc(u.id)+'\')">Sıfırlama E-postası</button> '+
    (u.role === "admin" ? "" : '<button class="btn-del" onclick="personelSil(\''+esc(u.id)+'\')">Erişimi Kapat</button>')+'</td></tr>').join("");
}
async function personelEkle() {
  if (!aktifKullanici || aktifKullanici.rol !== "admin") return;
  const ad=$("yeniPersonelAd").value.trim(), email=$("yeniPersonelEmail").value.trim().toLowerCase(), sifre=$("yeniPersonelSifre").value;
  if (!ad||!email||!sifre) { alert("Ad, e-posta ve başlangıç şifresi girin."); return; }
  if (sifre.length<6) { alert("Şifre en az 6 karakter olmalı."); return; }
  try {
    const c=await personelAuth.createUserWithEmailAndPassword(email,sifre);
    await db.collection("profiles").doc(c.user.uid).set({ad,email,role:"personel",active:true,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    await personelAuth.signOut(); $("yeniPersonelAd").value=""; $("yeniPersonelEmail").value=""; $("yeniPersonelSifre").value="";
    await adminKullaniciTablosuCiz(); alert(ad+" hesabı oluşturuldu.");
  } catch(e) { try { await personelAuth.signOut(); } catch(x) {} alert("Hesap oluşturulamadı: "+hataMetni(e)); }
}
async function personelAdiDegistir(id) {
  const u=kullanicilar.find(x=>x.id===id); if(!u||aktifKullanici.rol!=="admin")return;
  const ad=prompt(u.ad+" için yeni görünen ad:",u.ad); if(!ad||!ad.trim())return;
  try { await db.collection("profiles").doc(id).update({ad:ad.trim()}); if(id===aktifKullanici.id){aktifKullanici.ad=ad.trim();$("aktifKullaniciTag").innerText="👤 "+ad.trim();$("personelAd").value=ad.trim();} await adminKullaniciTablosuCiz(); }
  catch(e){alert("Ad güncellenemedi: "+hataMetni(e));}
}
async function sifreSifirlamaGonder(id) {
  const u=kullanicilar.find(x=>x.id===id); if(!u||!u.email||aktifKullanici.rol!=="admin")return;
  if(!confirm(u.email+" adresine şifre sıfırlama bağlantısı gönderilsin mi?"))return;
  try { await auth.sendPasswordResetEmail(u.email); alert("Sıfırlama bağlantısı gönderildi: "+u.email); } catch(e){alert(hataMetni(e));}
}
async function personelSil(id) {
  const u=kullanicilar.find(x=>x.id===id); if(!u||u.role==="admin"||aktifKullanici.rol!=="admin")return;
  if(!confirm(u.ad+" hesabının erişimi kapatılsın mı? Kayıtları korunur."))return;
  try { await db.collection("profiles").doc(id).update({active:false}); await adminKullaniciTablosuCiz(); } catch(e){alert(hataMetni(e));}
}

function urunMetniniDoldur() { $("urunMetin").value=Object.entries(urunler).map(x=>x[0]+";"+x[1]).join("\n"); $("urunSayac").innerText=Object.keys(urunler).length; }
function urunMetniniCoz(m) { const o={}; m.split(/\r?\n/).forEach(s=>{s=s.trim();if(!s)return;const i=s.search(/[;,\t]/);if(i<1)return;const b=s.slice(0,i).trim().replace(/^"|"$/g,""),a=s.slice(i+1).trim().replace(/^"|"$/g,"");if(b&&a)o[b]=a;});return o; }
async function urunleriKaydet() {
  if(!aktifKullanici||aktifKullanici.rol!=="admin")return; const next=urunMetniniCoz($("urunMetin").value);
  try { const old=await db.collection("products").get(); let batch=db.batch(),n=0;
    for(const d of old.docs) if(!Object.prototype.hasOwnProperty.call(next,d.id)){batch.delete(d.ref);if(++n>=400){await batch.commit();batch=db.batch();n=0;}}
    for(const b in next){batch.set(db.collection("products").doc(b),{ad:next[b],updatedAt:firebase.firestore.FieldValue.serverTimestamp()});if(++n>=400){await batch.commit();batch=db.batch();n=0;}}
    if(n)await batch.commit(); urunler=next; urunMetniniDoldur(); alert(Object.keys(next).length+" ürün Firebase'e kaydedildi.");
  }catch(e){alert("Ürünler kaydedilemedi: "+hataMetni(e));}
}
function urunDosyaYukle(i){const f=i.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{$("urunMetin").value=String(r.result||"").replace(/^\uFEFF/,"");urunleriKaydet();i.value="";};r.readAsText(f,"utf-8");}

function sesButonuGuncelle(){$("btnSes").innerText=sesAcik?"🔊 Ses: Açık":"🔇 Ses: Kapalı";}
function sesDegistir(){sesAcik=!sesAcik;Depo.yaz("zumrut_ses",sesAcik);sesButonuGuncelle();}
function bip(err){if(!sesAcik)return;try{const c=new(window.AudioContext||window.webkitAudioContext)(),o=c.createOscillator();o.frequency.value=err?300:900;o.connect(c.destination);o.start();setTimeout(()=>{o.stop();c.close();},err?300:150);}catch(e){}}
function uyari(m,h){const e=$("okunduUyari");e.innerText=m;e.className=h?"hata":"";e.style.display="block";clearTimeout(uyari.t);uyari.t=setTimeout(()=>e.style.display="none",1400);}
async function kameraDegistir(){kameraAcik?await kameraKapat():kameraAc();}
function kameraAc(){if(kameraAcik)return;html5QrCode=new Html5Qrcode("reader");html5QrCode.start({facingMode:"environment"},{fps:10,qrbox:{width:250,height:150}},text=>{const n=Date.now();if(kilit||(text===sonOkunan&&n-sonOkunanZaman<3000))return;kilit=true;sonOkunan=text;sonOkunanZaman=n;if(!$("faturaBaslik").value.trim()){uyari("⚠️ Önce Fatura / İrsaliye adını yazın!",true);bip(true);setTimeout(()=>kilit=false,1500);return;}adetSor(text);}).then(()=>{kameraAcik=true;$("btnKamera").innerText="⏹️ Kamerayı Durdur";$("btnKamera").className="btn btn-gray";$("btnFener").style.display="block";}).catch(e=>{html5QrCode=null;alert("Kamera açılamadı: "+e);});}
let bekleyenBarkod="";
function adetSor(b){bekleyenBarkod=b;$("modalBarkod").innerText=b;$("modalUrun").innerText=urunler[b]||"";const m=aktifKalemler.find(x=>x.barkod===b);$("modalMevcut").innerText=m?"Listede zaten "+m.adet+" adet var, girdiğiniz adet üzerine eklenir.":"";$("modalAdet").value=1;$("adetModal").style.display="flex";bip();if(navigator.vibrate)navigator.vibrate(150);setTimeout(()=>{$("modalAdet").focus();$("modalAdet").select();},80);}
function adetModalKapat(){$("adetModal").style.display="none";bekleyenBarkod="";sonOkunanZaman=Date.now();kilit=false;}
function adetOnayla(){const a=parseInt($("modalAdet").value);if(!a||a<1){alert("Lütfen 1 veya daha büyük bir adet girin!");return;}const b=bekleyenBarkod;$("barkodGiris").value=b;$("adet").value=a;const ok=kalemEkle(true);adetModalKapat();if(ok){bip();uyari("✅ EKLENDİ: "+b+" × "+a+"\nSıradaki barkodu okutun");}}
function adetIptal(){$("barkodGiris").value="";adetModalKapat();uyari("İptal edildi. Sıradaki barkodu okutun");}
async function kameraKapat(){if(html5QrCode&&kameraAcik){try{await html5QrCode.stop();html5QrCode.clear();}catch(e){}}html5QrCode=null;kameraAcik=false;fenerAcik=false;$("btnKamera").innerText="📷 Kamerayı Başlat";$("btnKamera").className="btn btn-primary";$("btnFener").style.display="none";}
async function fenerDegistir(){try{const v=document.querySelector("#reader video"),t=v.srcObject.getVideoTracks()[0];fenerAcik=!fenerAcik;await t.applyConstraints({advanced:[{torch:fenerAcik}]});$("btnFener").innerText=fenerAcik?"🔦 Fener: Açık":"🔦 Fener";}catch(e){fenerAcik=false;alert("Bu cihaz veya tarayıcı fener kontrolünü desteklemiyor.");}}

function kalemEkle(auto){if(!$("faturaBaslik").value.trim()){uyari("⚠️ Önce Fatura / İrsaliye adını yazın!",true);if(!auto)alert("Önce Fatura / İrsaliye adını yazın!");return false;}const b=$("barkodGiris").value.trim(),a=Math.max(1,parseInt($("adet").value)||1);if(!b){alert("Lütfen barkod okutun veya yazın!");return false;}const m=aktifKalemler.find(x=>x.barkod===b);if(m){m.adet+=a;m.saat=new Date().toLocaleTimeString("tr-TR");}else{const s=parseInt($("siraNo").value)||(aktifKalemler.length+1);aktifKalemler.push({sira:s,barkod:b,adet:a,saat:new Date().toLocaleTimeString("tr-TR")});$("siraNo").value=s+1;}$("barkodGiris").value="";$("adet").value=1;tabloCiz();taslakKaydet();return true;}
function kalemSil(i){const k=aktifKalemler[i];if(!k||!confirm(k.barkod+" satırı silinsin mi?"))return;aktifKalemler.splice(i,1);tabloCiz();taslakKaydet();}
function tabloCiz(){$("kalemTablosu").innerHTML=aktifKalemler.map((k,i)=>({k,i})).reverse().map(x=>'<tr><td><span class="badge">#'+esc(x.k.sira)+'</span></td><td>'+esc(x.k.barkod)+(urunler[x.k.barkod]?'<span class="urun-ad">'+esc(urunler[x.k.barkod])+'</span>':'')+'</td><td><span class="badge-qty">'+x.k.adet+'</span></td><td><button class="btn-del" onclick="kalemSil('+x.i+')">Sil</button></td></tr>').join("");$("kalemSayac").innerText=aktifKalemler.length;$("toplamAdet").innerText=aktifKalemler.reduce((a,k)=>a+k.adet,0);}
function taslakKaydet(){if(!aktifKullanici)return;const t={baslik:$("faturaBaslik").value,kalemler:aktifKalemler,sira:$("siraNo").value};Depo.yaz("zumrut_taslak_"+aktifKullanici.id,t);clearTimeout(taslakKaydet.timer);taslakKaydet.timer=setTimeout(()=>db.collection("drafts").doc(aktifKullanici.id).set(Object.assign({},t,{updatedAt:firebase.firestore.FieldValue.serverTimestamp()})).catch(e=>console.error("Taslak kaydedilemedi",e)),500);}
async function taslakYukle(){let t=null;try{const s=await db.collection("drafts").doc(aktifKullanici.id).get();if(s.exists)t=s.data();}catch(e){}if(!t)t=Depo.oku("zumrut_taslak_"+aktifKullanici.id,null);aktifKalemler=t&&t.kalemler||[];$("faturaBaslik").value=t&&t.baslik||"";$("siraNo").value=t&&t.sira||aktifKalemler.length+1;tabloCiz();if(aktifKalemler.length)uyari("📝 Yarım kalan sayımınız geri yüklendi ("+aktifKalemler.length+" kalem)");}
async function taslakTemizle(){if(aktifKalemler.length&&!confirm("Listedeki tüm kalemler silinecek. Emin misiniz?"))return;aktifKalemler=[];$("faturaBaslik").value="";$("siraNo").value=1;$("barkodGiris").value="";Depo.sil("zumrut_taslak_"+aktifKullanici.id);try{await db.collection("drafts").doc(aktifKullanici.id).delete();}catch(e){alert(hataMetni(e));}tabloCiz();}

async function faturaKaydet(){const baslik=$("faturaBaslik").value.trim();if(!baslik){alert("Lütfen fatura adını yazın!");return;}if(!aktifKalemler.length){alert("Listede hiç ürün yok!");return;}const ex=Object.entries(tumFaturalar).find(x=>x[1].baslik===baslik&&(aktifKullanici.rol==="admin"||x[1].ownerUid===aktifKullanici.id));if(ex&&!confirm("'"+baslik+"' faturası zaten var. Üzerine yazılsın mı?"))return;const now=new Date(),d={baslik,ownerUid:aktifKullanici.id,personel:aktifKullanici.ad,tarih:now.toLocaleDateString("tr-TR")+" "+now.toLocaleTimeString("tr-TR"),kalemler:aktifKalemler.map(k=>Object.assign({},k,{urun:urunler[k.barkod]||""})),updatedAt:firebase.firestore.FieldValue.serverTimestamp()};try{if(ex)await db.collection("invoices").doc(ex[0]).set(d);else{d.createdAt=firebase.firestore.FieldValue.serverTimestamp();await db.collection("invoices").add(d);}aktifKalemler=[];$("faturaBaslik").value="";$("barkodGiris").value="";$("siraNo").value=1;Depo.sil("zumrut_taslak_"+aktifKullanici.id);try{await db.collection("drafts").doc(aktifKullanici.id).delete();}catch(e){}tabloCiz();await bulutFaturalariYukle();uyari("💾 Fatura Firebase'e kaydedildi: "+baslik);if(aktifKullanici.rol==="admin")faturaListesiGuncelle();}catch(e){alert("Fatura kaydedilemedi: "+hataMetni(e));}}
function faturaListesiGuncelle(){if(!aktifKullanici||aktifKullanici.rol!=="admin")return;const q=$("faturaAra").value.trim().toLocaleLowerCase("tr-TR"),s=$("faturaSecici"),old=s.value,rows=Object.entries(tumFaturalar).filter(x=>!q||(x[1].baslik||"").toLocaleLowerCase("tr-TR").includes(q)||(x[1].personel||"").toLocaleLowerCase("tr-TR").includes(q));genelRaporCiz();if(!rows.length){s.innerHTML="<option value=''>Kayıtlı fatura yok</option>";$("detayTablosu").innerHTML="";$("faturaOzet").innerText="";return;}s.innerHTML=rows.map(x=>'<option value="'+esc(x[0])+'">'+esc(x[1].baslik)+' — '+esc(x[1].personel)+'</option>').join("");if(rows.some(x=>x[0]===old))s.value=old;faturaDetayGoster();}
function genelRaporCiz(){const a=Object.values(tumFaturalar),k=a.reduce((n,f)=>n+(f.kalemler||[]).length,0),adet=a.reduce((n,f)=>n+(f.kalemler||[]).reduce((m,x)=>m+(+x.adet||0),0),0);$("genelRapor").innerHTML="<b>Genel toplam:</b> "+a.length+" fatura, "+k+" kalem, "+adet+" adet";}
function faturaDetayGoster(){const f=tumFaturalar[$("faturaSecici").value];if(!f){$("detayTablosu").innerHTML="";$("faturaOzet").innerText="";return;}const a=f.kalemler||[],n=a.reduce((x,k)=>x+(+k.adet||0),0);$("faturaOzet").innerHTML="<b>Personel:</b> "+esc(f.personel)+"<br><b>Tarih:</b> "+esc(f.tarih)+"<br><b>Kalem:</b> "+a.length+" | <b>Toplam:</b> "+n+" Adet";$("detayTablosu").innerHTML=a.map(k=>'<tr><td><span class="badge">#'+esc(k.sira)+'</span></td><td>'+esc(k.barkod)+((k.urun||urunler[k.barkod])?'<span class="urun-ad">'+esc(k.urun||urunler[k.barkod])+'</span>':'')+'</td><td><span class="badge-qty">'+esc(k.adet)+'</span></td><td>'+esc(k.saat)+'</td></tr>').join("");}
async function faturaSil(){const id=$("faturaSecici").value,f=tumFaturalar[id];if(!id||!f||aktifKullanici.rol!=="admin"||!confirm("'"+f.baslik+"' faturası kalıcı olarak silinsin mi?"))return;try{await db.collection("invoices").doc(id).delete();delete tumFaturalar[id];faturaListesiGuncelle();}catch(e){alert(hataMetni(e));}}

async function eskiVerileriAktar(){if(!aktifKullanici||aktifKullanici.rol!=="admin")return;const ps=Depo.oku("zumrut_urunler",{}),fs=Depo.oku("zumrut_faturalar",{}),draft=Depo.oku("zumrut_taslak_admin",null),pn=Object.keys(ps).length,fn=Object.keys(fs).length;if(!pn&&!fn&&!draft){alert("Bu tarayıcıda aktarılacak eski kayıt yok.");return;}if(!confirm("Bu cihazdaki "+pn+" ürün ve "+fn+" fatura Firebase'e kopyalansın mı? Yerel kayıtlar silinmez."))return;try{let b=db.batch(),n=0;for(const k in ps){b.set(db.collection("products").doc(k),{ad:String(ps[k]),updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});if(++n>=400){await b.commit();b=db.batch();n=0;}}for(const title in fs){const dup=Object.values(tumFaturalar).some(f=>f.baslik===title&&f.ownerUid===aktifKullanici.id);if(!dup){const f=fs[title];b.set(db.collection("invoices").doc(),{baslik:title,ownerUid:aktifKullanici.id,personel:f.personel||aktifKullanici.ad,tarih:f.tarih||new Date().toLocaleString("tr-TR"),kalemler:f.kalemler||[],createdAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()});if(++n>=400){await b.commit();b=db.batch();n=0;}}}if(n)await b.commit();if(draft)await db.collection("drafts").doc(aktifKullanici.id).set(Object.assign({},draft,{updatedAt:firebase.firestore.FieldValue.serverTimestamp()}),{merge:true});await bulutVerisiniYukle();urunMetniniDoldur();faturaListesiGuncelle();alert("Eski veriler Firebase'e aktarıldı. Yerel kopyalar korunuyor.");}catch(e){alert("Aktarım tamamlanamadı: "+hataMetni(e));}}

const BASLIKLAR=["Sıra No","Barkod","Ürün Adı","Adet","Kayıt Saati","Personel","Fatura Başlığı","Fatura Tarihi"];
function satirlariHazirla(f){return(f.kalemler||[]).map(k=>[k.sira,k.barkod,k.urun||urunler[k.barkod]||"",k.adet,k.saat,f.personel,f.baslik,f.tarih]);}
function excelIndir(){const f=tumFaturalar[$("faturaSecici").value];if(!f)return;if(!window.XLSX){alert("Excel kütüphanesi yüklenemedi; CSV indiriliyor.");csvIndir();return;}const ws=XLSX.utils.aoa_to_sheet([BASLIKLAR].concat(satirlariHazirla(f)));ws["!cols"]=[{wch:8},{wch:18},{wch:28},{wch:8},{wch:12},{wch:20},{wch:24},{wch:20}];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Fatura");XLSX.writeFile(wb,(f.baslik||"fatura").replace(/[\\/:*?"<>|]/g,"_")+".xlsx");}
function csvIndir(){const f=tumFaturalar[$("faturaSecici").value];if(!f)return;const q=v=>'"'+String(v).replace(/"/g,'""')+'"',csv="\uFEFF"+BASLIKLAR.map(q).join(";")+"\n"+satirlariHazirla(f).map(a=>a.map(q).join(";")).join("\n")+"\n",link=document.createElement("a");link.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));link.download=(f.baslik||"fatura").replace(/[\\/:*?"<>|]/g,"_")+".csv";link.click();URL.revokeObjectURL(link.href);}
$("loginEmail").addEventListener("keydown",e=>{if(e.key==="Enter")girisYap();});
$("loginSifre").addEventListener("keydown",e=>{if(e.key==="Enter")girisYap();});
