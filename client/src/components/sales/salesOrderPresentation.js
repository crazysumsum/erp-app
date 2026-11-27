export const statusLabels={DRAFT:"草稿",CONFIRMING:"確認中",CONFIRMED:"已確認",PARTIALLY_FULFILLED:"部分已履約",COMPLETED:"已完成",CANCELLED:"已取消",CLOSED:"已關閉"};
export const statusColors={DRAFT:"grey",CONFIRMING:"warning",CONFIRMED:"primary",PARTIALLY_FULFILLED:"primary",COMPLETED:"positive",CANCELLED:"negative",CLOSED:"grey"};
export const quantityLabels={ordered:"訂購數量",reserved:"已預留數量",backordered:"欠貨數量",fulfilled:"已履約數量",cancelled:"已取消數量",outstanding:"未履約數量"};
export const historyActionLabels={
 created:"建立訂單",confirm_started:"開始確認",confirm_failed:"確認失敗",confirmed:"確認訂單",
 withdrawn:"撤回確認",cancelled:"取消訂單",remaining_closed:"關閉剩餘數量",
 backorder_allocated:"欠貨已補配",backorder_deferred:"欠貨等待補配",
 FULFILLMENT_CONFIRM:"確認出貨",FULFILLMENT_REVERSE_REOPEN:"沖銷出貨",
};
export const sourceLabels={MANUAL:"人工",QUOTATION:"報價轉單",CSV:"CSV",CHANNEL:"渠道"};
