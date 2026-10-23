import {it,expect,vi} from 'vitest';import {CollectorSession} from '../collector-http';
it('refuses unapproved source and redirect hosts before disclosing session cookies',async()=>{
 const fetcher=vi.fn(async()=>new Response('',{status:302,headers:{location:'https://unapproved.example/collect'}}));
 await expect(new CollectorSession(fetcher as any).read('https://www.hctax.net/Property/ViewStatementReceipts')).rejects.toThrow('approved');expect(fetcher).toHaveBeenCalledTimes(1);
 await expect(new CollectorSession(fetcher as any).read('http://www.hctax.net/')).rejects.toThrow('approved');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('discloses CAPTCHA/access failures without returning guessed data',async()=>{
 const fetcher=vi.fn(async()=>new Response('<div class="g-recaptcha">Complete verification</div>'));
 await expect(new CollectorSession(fetcher as any).read('https://www.hctax.net/Property/ViewStatementReceipts')).rejects.toThrow('interactive access');
});
it('keeps ordinary public session cookies isolated to each origin',async()=>{
 const calls:any[]=[];const fetcher=vi.fn(async(url:any,init:any)=>{calls.push({url,headers:init.headers});return new Response('public',{headers:{'Set-Cookie':'SESSION=synthetic; HttpOnly; Secure'}});});
 const session=new CollectorSession(fetcher as any);await session.read('https://www.hctax.net/Property/ViewStatementReceipts');await session.read('https://www.hctax.net/Property/AccountEncrypt?account=0612170060008');await session.read('https://travis.go2gov.net/export?account=02371408060000&type=org');
 expect(calls[1].headers.Cookie).toBe('SESSION=synthetic');expect(calls[2].headers.Cookie).toBeUndefined();
});
