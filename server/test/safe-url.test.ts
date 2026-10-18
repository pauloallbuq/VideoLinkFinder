import {describe,it,expect} from 'vitest';
import {safeUrl} from '../src/crawler.js';
describe('safeUrl',()=>{
 it('rejects non-http schemes',async()=>{await expect(safeUrl('file:///etc/passwd')).rejects.toThrow()});
 it('rejects localhost',async()=>{await expect(safeUrl('http://localhost:3000')).rejects.toThrow()});
 it('rejects private IPv4',async()=>{await expect(safeUrl('http://192.168.1.1')).rejects.toThrow()});
 it('accepts a public HTTPS host',async()=>{await expect(safeUrl('https://example.com')).resolves.toBeInstanceOf(URL)});
});
