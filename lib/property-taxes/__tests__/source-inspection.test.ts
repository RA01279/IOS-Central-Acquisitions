import {it,expect} from 'vitest';
import {isAccessChallenge} from '../source-inspection';
it('does not classify a public page containing a contact-form CAPTCHA as an access barrier',()=>{
 expect(isAccessChallenge('<title>County tax office</title><h1>Public property search</h1><form class="g-recaptcha">Contact us</form>')).toBe(false);
 expect(isAccessChallenge('<title>Just a moment...</title><script src="/cf-chl-platform"></script>')).toBe(true);
 expect(isAccessChallenge('<h1>Performing security verification</h1>')).toBe(true);
});
