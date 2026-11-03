import {NextRequest} from 'next/server';
import {GET as run} from '../route';
export const dynamic='force-dynamic';
export const maxDuration=300;
/** Staggered daily schedules share the authenticated worker and global lease. */
export async function GET(req:NextRequest){return run(req);}
