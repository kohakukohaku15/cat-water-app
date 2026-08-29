const SESSION_KEY="catWaterSupabaseSession";
const setupMessage=document.querySelector("#setup-message"),authSection=document.querySelector("#auth-section"),appSection=document.querySelector("#app-section"),authForm=document.querySelector("#auth-form"),emailInput=document.querySelector("#email"),passwordInput=document.querySelector("#password"),loginButton=document.querySelector("#login-button"),signupButton=document.querySelector("#signup-button"),logoutButton=document.querySelector("#logout-button"),authMessage=document.querySelector("#auth-message"),form=document.querySelector("#water-form"),dateInput=document.querySelector("#date"),amountInput=document.querySelector("#amount"),list=document.querySelector("#record-list"),empty=document.querySelector("#empty"),average=document.querySelector("#average"),count=document.querySelector("#count"),message=document.querySelector("#message"),chart=document.querySelector("#water-chart");
let session=loadSession(),records=[];
dateInput.value=dateKey(new Date());startApp();

authForm.addEventListener("submit",async function(event){event.preventDefault();await signIn()});
signupButton.addEventListener("click",signUp);logoutButton.addEventListener("click",signOut);
form.addEventListener("submit",async function(event){
  event.preventDefault();const amount=Number(amountInput.value);
  if(!dateInput.value||!Number.isFinite(amount)||amount<=0){showMessage("日付と、1ml以上の飲水量を入力してください。",true);return}
  setFormBusy(true);showMessage("保存しています…",false);
  try{await ensureSession();const userId=getCurrentUserId();const response=await apiFetch("/rest/v1/water_records",{method:"POST",headers:{"Content-Type":"application/json","Prefer":"return=representation"},body:JSON.stringify({date:dateInput.value,amount:amount,user_id:userId})});const saved=await response.json();records.push(saved[0]);render();amountInput.value="";amountInput.focus();showMessage("記録を保存しました。",false)}catch(error){handleDataError(error,"記録を保存できませんでした。")}finally{setFormBusy(false)}
});
list.addEventListener("click",async function(event){
  const button=event.target.closest("button[data-id]");if(!button)return;button.disabled=true;
  try{await ensureSession();const userId=getCurrentUserId();await apiFetch("/rest/v1/water_records?id=eq."+encodeURIComponent(button.dataset.id)+"&user_id=eq."+encodeURIComponent(userId),{method:"DELETE"});records=records.filter(function(record){return String(record.id)!==button.dataset.id});render();showMessage("記録を削除しました。",false)}catch(error){button.disabled=false;handleDataError(error,"記録を削除できませんでした。")}
});

async function startApp(){
  if(!hasConfig()){setupMessage.hidden=false;authSection.hidden=true;appSection.hidden=true;return}
  if(!session){showAuth();return}
  try{await ensureSession();await showApp()}catch(error){clearSession();showAuth("ログインの有効期限が切れました。もう一度ログインしてください。",true)}
}
async function signUp(){
  if(!validateAuthInputs())return;setAuthBusy(true);showAuthMessage("登録しています…",false);
  try{
    const response=await fetch(cleanUrl()+"/auth/v1/signup",{method:"POST",headers:{apikey:SUPABASE_PUBLISHABLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({email:emailInput.value.trim().toLowerCase(),password:passwordInput.value,email_redirect_to:APP_PUBLIC_URL})});
    const data=await readResponse(response);
    if(data.user&&Array.isArray(data.user.identities)&&data.user.identities.length===0){throw createAuthError("user_already_exists","User already registered")}
    if(data.access_token&&data.user){setSession(data);passwordInput.value="";await showApp()}
    else if(data.user){passwordInput.value="";showAuthMessage("確認メールを送信しました。メール内のリンクを確認してください。",false)}
    else{throw createAuthError("unexpected_signup_response","登録結果を確認できませんでした。")}
  }catch(error){showAuthMessage(authErrorMessage(error,true),true)}finally{setAuthBusy(false)}
}
async function signIn(){
  if(!validateAuthInputs())return;setAuthBusy(true);showAuthMessage("ログインしています…",false);
  try{const response=await fetch(cleanUrl()+"/auth/v1/token?grant_type=password",{method:"POST",headers:{apikey:SUPABASE_PUBLISHABLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({email:emailInput.value.trim(),password:passwordInput.value})});setSession(await readResponse(response));passwordInput.value="";await showApp()}catch(error){showAuthMessage(authErrorMessage(error),true)}finally{setAuthBusy(false)}
}
async function signOut(){
  logoutButton.disabled=true;
  try{if(session)await fetch(cleanUrl()+"/auth/v1/logout",{method:"POST",headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:"Bearer "+session.access_token}})}finally{clearSession();records=[];render();logoutButton.disabled=false;showAuth("ログアウトしました。",false)}
}
async function showApp(){authSection.hidden=true;setupMessage.hidden=true;appSection.hidden=false;showMessage("記録を読み込んでいます…",false);await fetchRecords();showMessage("",false)}
function showAuth(text,isError){appSection.hidden=true;setupMessage.hidden=true;authSection.hidden=false;if(text)showAuthMessage(text,isError)}
async function fetchRecords(){await ensureSession();const userId=getCurrentUserId();const response=await apiFetch("/rest/v1/water_records?select=id,created_at,date,amount,user_id&user_id=eq."+encodeURIComponent(userId)+"&order=date.desc,created_at.desc");records=await response.json();render()}
async function apiFetch(path,options){options=options||{};const headers=Object.assign({},options.headers,{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:"Bearer "+session.access_token});const response=await fetch(cleanUrl()+path,Object.assign({},options,{headers:headers}));if(!response.ok)await readResponse(response);return response}
async function ensureSession(){
  if(!session||!session.refresh_token)throw new Error("no_session");
  if(session.expires_at&&Date.now()<session.expires_at*1000-60000){getCurrentUserId();return}
  const response=await fetch(cleanUrl()+"/auth/v1/token?grant_type=refresh_token",{method:"POST",headers:{apikey:SUPABASE_PUBLISHABLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({refresh_token:session.refresh_token})});setSession(await readResponse(response))
  getCurrentUserId();
}
async function readResponse(response){let data={};try{data=await response.json()}catch(error){}if(!response.ok){const apiError=createAuthError(data.code||data.error_code||"request_failed",data.msg||data.message||data.error_description||data.error||"リクエストに失敗しました。");apiError.status=response.status;throw apiError}return data}
function createAuthError(code,message){const error=new Error(message);error.code=code;return error}
function setSession(data){session={access_token:data.access_token,refresh_token:data.refresh_token,expires_at:data.expires_at||Math.floor(Date.now()/1000)+(data.expires_in||3600),user:data.user};localStorage.setItem(SESSION_KEY,JSON.stringify(session))}
function loadSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY))}catch(error){return null}}
function clearSession(){session=null;localStorage.removeItem(SESSION_KEY)}
function getCurrentUserId(){if(!session||!session.user||!session.user.id)throw new Error("no_session");return session.user.id}

function render(){
  list.innerHTML="";[...records].sort(function(a,b){return b.date.localeCompare(a.date)||String(b.created_at).localeCompare(String(a.created_at))}).forEach(function(record){const item=document.createElement("li"),date=document.createElement("span"),amount=document.createElement("span"),button=document.createElement("button");date.textContent=formatDate(record.date);amount.className="amount";amount.textContent=record.amount+" ml";button.type="button";button.className="delete";button.dataset.id=record.id;button.textContent="削除";button.setAttribute("aria-label",date.textContent+"の記録を削除");item.append(date,amount,button);list.appendChild(item)});
  empty.hidden=records.length>0;count.textContent=records.length+"件";const total=records.reduce(function(sum,record){return sum+Number(record.amount)},0);average.textContent=records.length?Math.round(total/records.length):0;renderChart()
}
function renderChart(){
  chart.innerHTML="";const days=[];
  for(let i=6;i>=0;i--){const day=new Date();day.setHours(0,0,0,0);day.setDate(day.getDate()-i);const key=dateKey(day);const amount=records.filter(function(record){return record.date===key}).reduce(function(sum,record){return sum+Number(record.amount)},0);days.push({date:key,label:(day.getMonth()+1)+"/"+day.getDate(),amount:amount})}
  const max=Math.max(...days.map(function(day){return day.amount}),1);days.forEach(function(day){const column=document.createElement("div"),value=document.createElement("span"),area=document.createElement("div"),bar=document.createElement("div"),date=document.createElement("span");column.className="chart-day";value.className="chart-value";area.className="bar-area";bar.className="chart-bar"+(day.amount===0?" zero":"");date.className="chart-date";value.textContent=day.amount+" ml";bar.style.height=(day.amount===0?3:Math.max(day.amount/max*100,8))+"%";bar.title=formatDate(day.date)+"："+day.amount+" ml";date.textContent=day.label;area.appendChild(bar);column.append(value,area,date);chart.appendChild(column)})
}
function validateAuthInputs(){if(!emailInput.validity.valid){showAuthMessage("正しいメールアドレスを入力してください。",true);return false}if(passwordInput.value.length<6){showAuthMessage("パスワードは6文字以上で入力してください。",true);return false}return true}
function authErrorMessage(error,isSignup){const text=String(error.message).toLowerCase(),code=String(error.code||"").toLowerCase();if(code==="user_already_exists"||text.includes("already registered")||text.includes("already been registered"))return"このメールアドレスは登録済みです。ログインしてください。";if(code==="signup_disabled")return"現在、新規登録は停止されています。管理者にお問い合わせください。";if(code==="email_address_invalid"||text.includes("invalid email"))return"メールアドレスの形式が正しくありません。";if(code==="weak_password"||text.includes("weak password"))return"パスワードが簡単すぎます。より長く複雑なパスワードを設定してください。";if(code.includes("rate_limit")||text.includes("rate limit"))return"短時間に何度も試行されています。しばらく待ってからもう一度お試しください。";if(text.includes("invalid login credentials"))return"メールアドレスまたはパスワードが違います。";if(text.includes("email not confirmed"))return"確認メール内のリンクを開いてからログインしてください。";if(text.includes("password"))return"パスワードの条件を満たしていません。6文字以上で設定してください。";if(text.includes("failed to fetch"))return"Supabaseに接続できません。URLと通信環境を確認してください。";const detail=String(error.message||"").trim();if(isSignup&&detail&&detail!=="request_failed")return"登録できませんでした："+detail;return"認証に失敗しました。入力内容を確認して、もう一度お試しください。"}
function handleDataError(error,fallback){if(error.status===401||error.status===403||error.message==="no_session"){clearSession();showAuth("ログインの有効期限が切れました。もう一度ログインしてください。",true);return}showMessage(error.message==="Failed to fetch"?"Supabaseに接続できません。通信環境を確認してください。":fallback,true)}
function hasConfig(){return typeof SUPABASE_URL==="string"&&/^https:\/\/.+\.supabase\.co\/?$/.test(SUPABASE_URL)&&typeof SUPABASE_PUBLISHABLE_KEY==="string"&&!SUPABASE_PUBLISHABLE_KEY.startsWith("YOUR_")&&!SUPABASE_PUBLISHABLE_KEY.includes("service_role")&&!SUPABASE_PUBLISHABLE_KEY.startsWith("sb_secret_")}
function cleanUrl(){return SUPABASE_URL.replace(/\/$/,"")}
function setAuthBusy(busy){loginButton.disabled=busy;signupButton.disabled=busy;emailInput.disabled=busy;passwordInput.disabled=busy}
function setFormBusy(busy){form.querySelector("button").disabled=busy;dateInput.disabled=busy;amountInput.disabled=busy}
function showAuthMessage(text,isError){authMessage.textContent=text;authMessage.style.color=isError?"#c45b5b":"#347f8c"}
function showMessage(text,isError){message.textContent=text;message.style.color=isError?"#c45b5b":"#347f8c"}
function formatDate(value){const p=value.split("-");return p[0]+"年"+Number(p[1])+"月"+Number(p[2])+"日"}
function dateKey(date){return date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0")}
