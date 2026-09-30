import './style.css';
import { ADDRESS, EXPLORER, account, connect, read, write } from './contract.js';

const app = document.querySelector('#app');
let jobs = [];
let active = null;
let busy = false;
let message = '';
const short = a => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—';
const when = s => s ? new Date(s * 1000).toLocaleString() : '—';
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const gen = wei => (Number(BigInt(wei || 0)) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 6 });
const now = () => Math.floor(Date.now() / 1000);
function amount(raw) {
  if (!/^\d+(\.\d{1,18})?$/.test(raw) || Number(raw) <= 0) throw new Error('Enter a positive GEN amount with at most 18 decimal places.');
  const [whole, fraction = ''] = raw.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
}
async function digest(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function field(name, label, opts = {}) {
  return `<label>${label}<input name="${name}" ${opts.type ? `type="${opts.type}"` : ''} ${opts.placeholder ? `placeholder="${opts.placeholder}"` : ''} ${opts.required === false ? '' : 'required'} ${opts.min ? `min="${opts.min}"` : ''} /></label>`;
}
function action(label, name, form) {
  return `<details class="action"><summary>${label}</summary><form data-action="${name}">${form}<button type="submit">Submit to GenLayer</button></form></details>`;
}
function editor(j) {
  const me = account()?.toLowerCase();
  const client = me === j.client, freelancer = me === j.freelancer, t = now();
  const evidence = `${field('url', 'Public HTTPS evidence URL', { type: 'url', placeholder: 'https://…' })}${field('hash', 'SHA-256 of the exact response bytes', { placeholder: '64 lowercase hex characters' })}<p class="hint">Each side has three slots. Evidence is public and cannot be replaced. Hashes must match the fetched bytes.</p>`;
  let actions = [];
  if (freelancer && j.state === 'OPEN' && t <= j.accept_by) actions.push(action('Accept job', 'accept_job', ''));
  if (freelancer && j.state === 'ACTIVE' && t <= j.deliver_by) actions.push(action('Submit delivery', 'submit_delivery', field('url', 'Public delivery URL', { type: 'url' }) + field('hash', 'SHA-256 of exact response bytes')));
  if (client && j.state === 'DELIVERED') {
    actions.push(action('Approve delivery', 'approve_delivery', ''));
    if (t <= j.review_by) actions.push(action('Open a dispute', 'open_dispute', '<label>What requirement is missing?<textarea name="reason" maxlength="1500" required></textarea></label>'));
  }
  if ((client || freelancer) && j.state === 'DISPUTED' && t <= j.evidence_by) {
    const count = client ? j.client_evidence.length : j.freelancer_evidence.length;
    if (count < 3) actions.push(action(client ? 'Submit counter-evidence' : 'Submit evidence', client ? 'submit_counter_evidence' : 'submit_evidence', evidence));
  }
  if (['DISPUTED', 'EVIDENCE_REVIEW'].includes(j.state) && t > j.evidence_by && (!j.retry_by || t <= j.retry_by)) actions.push(action('Request validator adjudication', 'adjudicate', ''));
  const expired = (j.state === 'OPEN' && t > j.accept_by) || (j.state === 'ACTIVE' && t > j.deliver_by) || (j.state === 'DELIVERED' && t > j.review_by) || (j.state === 'EVIDENCE_REVIEW' && t > j.retry_by);
  if (expired) actions.push(action('Finalize expired deadline', 'finalize', ''));
  if (client && Number(j.client_due) > 0) actions.push(action(`Claim refund · ${gen(j.client_due)} GEN`, 'claim_refund', ''));
  if (freelancer && Number(j.freelancer_due) > 0) actions.push(action(`Claim payment · ${gen(j.freelancer_due)} GEN`, 'claim_payment', ''));
  return actions.length ? actions.join('') : '<p class="hint">No wallet action is currently available for this account and state.</p>';
}
function evidenceList(items) {
  return items.length ? `<ul class="evidence">${items.map(x => `<li><a target="_blank" rel="noopener noreferrer" href="${escape(x.url)}">${escape(x.url)}</a><small>SHA-256 ${escape(x.sha256)}</small></li>`).join('')}</ul>` : '<p class="hint">No evidence committed.</p>';
}
function render() {
  const j = jobs.find(x => x.id === active) || jobs[0];
  if (j) active = j.id;
  app.innerHTML = `
  <header><div class="brand"><span class="mark">SC</span><span>ScopeCourt <small>GENLAYER / STUDIONET</small></span></div><button id="wallet" class="secondary">${account() ? short(account()) : 'Connect wallet'}</button></header>
  <main>
    <div class="top"><div><span class="eyebrow">FREELANCE ESCROW</span><h1>Work judged against the scope.</h1><p>Fund a job, share the delivery, and let GenLayer validators resolve a disputed scope.</p></div><div class="network"><span class="${ADDRESS ? 'online' : 'offline'}"></span>${ADDRESS ? `<a href="${EXPLORER}/address/${ADDRESS}" target="_blank" rel="noopener noreferrer" title="${ADDRESS}">Contract ${short(ADDRESS)}</a>` : 'Deployment pending'}<small>Finalized chain state only</small></div></div>
    ${message ? `<div role="status" class="notice">${escape(message)} <button id="dismiss" aria-label="Dismiss">×</button></div>` : ''}
    <div class="workspace">
      <aside class="sidebar"><div class="section-title"><h2>Jobs</h2><span>${jobs.length}</span></div>
      ${jobs.length ? jobs.slice().reverse().map(x => `<button class="job-card ${x.id === active ? 'selected' : ''}" data-job="${x.id}"><span class="job-number">JOB / ${String(x.id).padStart(3, '0')}</span><strong>${escape(x.title)}</strong><span class="job-bottom"><span>${gen(x.amount)} GEN</span><em>${escape(x.state.replaceAll('_', ' '))}</em></span></button>`).join('') : '<p class="empty">No finalized jobs found on this contract.</p>'}
      <button class="refresh secondary" id="refresh">Refresh finalized state</button></aside>
      <section class="detail">${j ? `
        <div class="detail-head"><div><span class="eyebrow">JOB / ${String(j.id).padStart(3, '0')}</span><h2>${escape(j.title)}</h2></div><span class="badge">${escape(j.state.replaceAll('_', ' '))}</span></div>
        <div class="metrics"><div><small>ESCROW</small><strong>${gen(j.amount)} GEN</strong></div><div><small>CLIENT</small><strong title="${escape(j.client)}">${short(j.client)}</strong></div><div><small>FREELANCER</small><strong title="${escape(j.freelancer)}">${short(j.freelancer)}</strong></div></div>
        <div class="grid"><div><h3>Agreed scope</h3><p class="scope">${escape(j.scope)}</p>${j.delivery ? `<h3>Delivery</h3><a target="_blank" rel="noopener noreferrer" href="${escape(j.delivery)}">${escape(j.delivery)}</a>` : ''}<h3>Evidence</h3><h4>Client · ${j.client_evidence.length}/3</h4>${evidenceList(j.client_evidence)}<h4>Freelancer · ${j.freelancer_evidence.length}/3</h4>${evidenceList(j.freelancer_evidence)}</div>
        <div><h3>Next actions</h3>${editor(j)}<div class="timeline"><h3>Decision & deadlines</h3>${j.verdict ? `<div class="verdict"><strong>${escape(j.verdict.replaceAll('_',' '))}</strong><p>${escape(j.reason)}</p><small>Client: ${gen(j.client_due)} GEN · Freelancer: ${gen(j.freelancer_due)} GEN claimable</small></div>` : j.reason ? `<p>${escape(j.reason)}</p>` : ''}
        ${[['Accept by',j.accept_by],['Deliver by',j.deliver_by],['Review by',j.review_by],['Evidence by',j.evidence_by],['Retry by',j.retry_by]].filter(x=>x[1]).map(x=>`<div class="deadline"><span>${x[0]}</span><time>${when(x[1])}</time></div>`).join('')}
        <h4>On-chain history</h4><ol>${j.history.map(x=>`<li>${escape(x)}</li>`).join('')}</ol></div></div></div>
      ` : `<div class="welcome"><span class="eyebrow">NEW AGREEMENT</span><h2>Start with a clear scope.</h2><p>Both parties can see the terms and escrow before work begins.</p></div>`}
      </section>
      <aside class="create"><span class="eyebrow">01 / CREATE</span><h2>Fund a job</h2><p>Escrow is locked when the client creates the agreement.</p>
        <form data-action="create_job">${field('title','Job title',{placeholder:'E-commerce landing page'})}<label>Agreed scope<textarea name="scope" maxlength="4000" placeholder="List the exact deliverables, acceptance criteria, and revision terms." required></textarea></label>${field('freelancer','Freelancer wallet address',{placeholder:'0x…'})}${field('amount','Escrow amount in GEN',{placeholder:'0.01'})}<div class="row">${field('accept','Days to accept',{type:'number',min:1})}${field('delivery','Days to deliver after acceptance',{type:'number',min:1})}</div><button type="submit" ${busy || !ADDRESS ? 'disabled' : ''}>Create funded job</button></form>
        <p class="hint">Public test network. Do not use for sensitive client material or real funds. Partial and inconclusive verdicts split escrow equally.</p>
      </aside>
    </div>
  </main><footer>ScopeCourt · GenLayer consensus · <a href="https://github.com/amzar1st/ScopeCourt" target="_blank" rel="noopener noreferrer">Source code</a></footer>`;
  bind();
}
async function refresh() {
  if (!ADDRESS) { jobs = []; render(); return; }
  try {
    const count = Number(await read('get_count'));
    if (!Number.isInteger(count) || count < 0 || count > 500) throw new Error('Unexpected job count');
    jobs = (await Promise.all(Array.from({length:count},(_,i)=>read('get_job',[i+1])))).map(x=>JSON.parse(x));
    message = 'Loaded finalized contract state.';
  } catch(e) { jobs=[]; message = `Could not read finalized contract state: ${e.message}`; }
  render();
}
async function submit(e) {
  e.preventDefault();
  if (busy) return;
  const form = e.currentTarget, name = form.dataset.action, data = Object.fromEntries(new FormData(form));
  const id = active;
  try {
    busy = true; message = 'Waiting for wallet and transaction finalization…'; render();
    let args = id ? [id] : [];
    let value;
    if (name === 'create_job') {
      value = amount(data.amount);
      args = [data.freelancer.trim(), data.title.trim(), data.scope.trim(), Number(data.accept), Number(data.delivery)];
      if (![Number(data.accept),Number(data.delivery)].every(Number.isInteger)) throw new Error('Enter whole-day deadlines.');
    } else if (name === 'submit_delivery') {
      if (!/^[a-f0-9]{64}$/.test(data.hash)) throw new Error('Enter the exact lowercase SHA-256 hash of the delivery response.');
      args.push(data.url.trim(), data.hash.trim());
    }
    else if (name === 'open_dispute') args.push(data.reason.trim());
    else if (name === 'submit_evidence' || name === 'submit_counter_evidence') {
      if (!/^https:\/\//.test(data.url)) throw new Error('Use a public HTTPS URL.');
      if (!/^[a-f0-9]{64}$/.test(data.hash)) throw new Error('Enter the exact lowercase SHA-256 hash of the evidence response.');
      args.push(data.url.trim(), data.hash.trim());
    }
    const hash = await write(name,args,value);
    message = `Finalized transaction: ${hash}`;
    await refresh();
    message = `Finalized transaction: ${hash}`;
  } catch(e) { message = e.message || 'Transaction failed'; }
  busy = false; render();
}
function bind() {
  document.querySelector('#wallet').onclick = async () => { try { await connect(); message='Wallet connected to Studionet.'; render(); } catch(e) { message=e.message; render(); } };
  document.querySelector('#refresh').onclick = refresh;
  document.querySelector('#dismiss')?.addEventListener('click',()=>{message='';render();});
  document.querySelectorAll('[data-job]').forEach(el=>el.onclick=()=>{active=Number(el.dataset.job);render();});
  document.querySelectorAll('form[data-action]').forEach(el=>el.addEventListener('submit',submit));
}
render();
refresh();
