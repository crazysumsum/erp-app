import { BaseService } from "../../../framework/services/BaseService.js";

/**
 * 清理設備綁定的兩張表。
 *
 * 兩件事拆成兩個 job 而不是一個掃兩張表：頻率差了三個數量級（nonce 每分鐘，
 * 設備每天），合在一起就得遷就快的那個，等於每分鐘對 user_devices 做一次
 * 沒有必要的全表掃描。失敗時分開記錄也比較看得出是哪一半壞了。
 *
 * 兩個都是 cluster scope：表是所有實例共用的，每台各掃一次就是把同一個 DELETE
 * 重複 N 次。改成 instance 不會產生錯誤結果（DELETE 是冪等的），只會白白增加
 * 資料庫負載——這種錯誤不會壞掉任何東西，所以也不會有人發現。
 */
export class DeviceBindingPurgeJob extends BaseService {
  static service = Object.freeze({
    name: "job.deviceBindingPurge",
    lifecycle: "singleton",
    dependencies: ["scheduler", "deviceBinding"],
    eager: true
  });

  static jobs = Object.freeze([
    {
      name: "deviceBinding.purgeNonces",
      method: "purgeNonces",
      scope: "cluster",
      // nonce 的保留期以分鐘計（預設 5 分鐘），所以每分鐘掃一次足以讓表維持在
      // 穩態大小。留久一點不會有正確性問題——過期的 nonce 只是佔空間，判重放
      // 靠的是主鍵而不是這個 job。
      intervalMs: 60_000,
      timeoutMs: 30_000
    },
    {
      name: "deviceBinding.purgeStaleDevices",
      method: "purgeStaleDevices",
      scope: "cluster",
      // 保留期以天計，一天掃一次就夠。
      intervalMs: 86_400_000,
      timeoutMs: 60_000
    }
  ]);

  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.deviceBinding = services.require("deviceBinding");
    this.scheduler = services.require("scheduler");
  }

  async initialize() {
    this.scheduler.register(this);
  }

  async purgeNonces() {
    await this.deviceBinding.purgeNonces();
  }

  async purgeStaleDevices() {
    await this.deviceBinding.purgeStaleDevices();
  }
}
