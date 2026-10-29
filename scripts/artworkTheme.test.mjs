import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PALETTE, extractPalette, normalizeAccent, rgbToHsl } from '../src/lib/artworkTheme.ts';
const pixels = regions => new Uint8ClampedArray(regions.flatMap(([count, color]) => Array.from({length:count},()=>color).flat()));
const hue = palette => rgbToHsl(...palette.accent.slice(1).match(/../g).map(value=>parseInt(value,16))).hue;
test('blue, red and green artwork retain their visual colour identity',()=>{
  for(const [color, expected] of [[[20,85,160,255],212],[[180,20,35,255],354],[[35,145,65,255],136]]) {
    const picked=hue(extractPalette(pixels([[500,color]])));
    const difference=Math.abs(picked-expected);
    assert.ok(Math.min(difference,360-difference)<12);
  }
});
test('dark borders, white highlights and tiny vivid outliers do not beat a representative colour',()=>{
  const palette=extractPalette(pixels([[1100,[5,5,8,255]],[700,[245,245,245,255]],[400,[35,100,165,255]],[6,[255,0,0,255]]]));
  assert.ok(hue(palette)>190 && hue(palette)<225);
});
test('achromatic, transparent and malformed pixel data use the same safe fallback',()=>{
  for(const input of [[],[10,20],pixels([[100,[120,120,120,255]]]),pixels([[100,[240,30,90,0]]])]) assert.deepEqual(extractPalette(input),DEFAULT_PALETTE);
});
test('red hues on opposite sides of zero belong to one cluster',()=>{
  const picked=hue(extractPalette(pixels([[200,[180,25,30,255]],[200,[180,30,25,255]],[250,[30,120,50,255]]])));
  assert.ok(picked<10 || picked>350);
});
test('all normalized hues keep Play foreground contrast above 7:1',()=>{
  const luminance=rgb=>rgb.map(c=>c/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[0.2126,0.7152,0.0722][i],0);
  const ink=luminance([16,25,35]);
  for(let h=0;h<360;h+=10) {
    const rgb=normalizeAccent(h,1).accent.slice(1).match(/../g).map(v=>parseInt(v,16));
    const surface=rgb.map((v,i)=>v*0.24+[224,237,247][i]*0.76);
    assert.ok((luminance(surface)+0.05)/(ink+0.05)>7);
  }
});
