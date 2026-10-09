export const validQuantity = value => typeof value === "string" && /^\d{1,14}(?:\.\d{1,6})?$/.test(value) && /[1-9]/.test(value);
export const validPrice = value => typeof value === "string" && /^\d{1,15}(?:\.\d{1,4})?$/.test(value);
function scaled(value,places) { const [whole,fraction=""]=value.split(".");return BigInt(whole)*10n**BigInt(places)+BigInt(fraction.padEnd(places,"0")); }
export function previewTotal(lines) {
 if(!lines.length || lines.some(line=>!validQuantity(line.quantity)||!validPrice(line.unitSellingPrice)))return "—";
 const total=lines.reduce((sum,line)=>sum+(scaled(line.quantity,6)*scaled(line.unitSellingPrice,4)+500000n)/1000000n,0n),digits=total.toString().padStart(5,"0");
 return `${digits.slice(0,-4)}.${digits.slice(-4)}`;
}
