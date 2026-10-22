import { writable } from 'svelte/store';

export const session = writable<any>({ connected: false, baseUrl: '', token: null, project: null });
let client: any = null;
export const setSession = (value: any) => session.set(value);
export const setClient = (value: any) => { client = value; };
export const getClient = () => client;
