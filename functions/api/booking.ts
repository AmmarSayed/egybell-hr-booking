// Cloudflare Pages Function: browser requests stay on the same origin.
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbzi64ASc30V_qrYkCz2sI_nrlTtmpMkfUD9QE0w_hvNzdXNzCQuvAoCeddDBnFufFe0PA/exec';
export async function onRequestPost({request}: {request: Request}) {
  const headers = {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  try {
    const text = await request.text();
    if(text.length > 2048) return new Response(JSON.stringify({error:'Request is too large.'}),{status:413,headers});
    const body = JSON.parse(text);
    if(!['availability','book'].includes(body.action)) return new Response(JSON.stringify({error:'Invalid request.'}),{status:400,headers});
    const response = await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body),redirect:'follow',signal:AbortSignal.timeout(25000)});
    const data = await response.json();
    return new Response(JSON.stringify(data),{status:response.ok?200:502,headers});
  } catch {
    return new Response(JSON.stringify({error:'The booking service could not be reached. Refresh availability before retrying; your previous booking may have saved.'}),{status:502,headers});
  }
}
