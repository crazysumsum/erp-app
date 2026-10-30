export const statusLabels={DRAFT:"草稿",PICKING:"揀貨中",PICKED:"已揀貨",SHIPPED:"已出貨",CANCELLED:"已取消",REVERSED:"已沖銷",CONFIRMED:"已確認",PARTIALLY_FULFILLED:"部分履約"};
export const statusColors={DRAFT:"grey",PICKING:"warning",PICKED:"positive",SHIPPED:"positive",CANCELLED:"grey",REVERSED:"negative",CONFIRMED:"positive",PARTIALLY_FULFILLED:"warning"};
export const timestamp=value=>new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",dateStyle:"short",timeStyle:"short"}).format(new Date(value));
