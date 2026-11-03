import type {TaxParcel} from './types';
export function jurisdictionKey(state:string,county:string){return `${state.trim().toUpperCase()}:${county.trim().replace(/\s+county$/i,'').toLowerCase()}`;}
/** Cosmetic separators never create a second collector account. Leading zeros
 * are preserved except in jurisdictions whose official search documents them
 * as optional. No parcel-to-collector alias is inferred from similar numbers. */
export function normalizedAccount(value:string){return value.trim().replace(/[\s-]/g,'').toUpperCase();}
export function accountKey(parcel:Pick<TaxParcel,'state'|'county'|'accountId'>){return `${jurisdictionKey(parcel.state,parcel.county)}:${normalizedAccount(parcel.accountId)}`;}
