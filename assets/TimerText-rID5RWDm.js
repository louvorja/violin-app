function i(t){const r=Math.abs(t),n=Math.floor(r/3600),a=Math.floor(r%3600/60),o=r%60;return`${t<0?"-":""}${String(n).padStart(2,"0")}:${String(a).padStart(2,"0")}:${String(o).padStart(2,"0")}`}function s(t=new Date){return`${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`}function c(t,r,n){return r?`${t}
${n}`:t}export{s as c,i as f,c as t};
