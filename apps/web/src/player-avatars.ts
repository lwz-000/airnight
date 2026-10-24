/**
 * ★★ 官方「个人头像」（玩家头像）清单 —— **由脚本生成，不要手改**。
 *
 * 生成：`node scripts/fetch-player-avatars.mjs`
 * 素材：`public/assets/player-avatars/<file>`（来源 fexli/ArknightsResource 的 avatar/DEFAULT）
 * 分类与命名和 PRTS「个人头像一览」一致：默认 / 动态 / 纪念（特殊获取）/ 活动。
 *
 * ★ 为什么是编译期常量而不是运行时拉 json？
 *   头像墙要同步画出两百多个格子，异步清单会带来"先空一下"的闪烁。
 */
export interface PlayerAvatar {
  /** 头像 id（`pa:` 前缀 + 文件名去后缀），存进 localStorage / 上报给服务器 */
  id: string;
  /** 文件名（`assets/player-avatars/` 下） */
  file: string;
  /** 显示名（PRTS 上也只有编号，所以是"默认 03 / 活动 OF / 纪念 91"这种） */
  label: string;
  /** 分组键，和 `PLAYER_AVATAR_GROUPS` 对得上 */
  group: string;
}

export const PLAYER_AVATAR_GROUPS = [
  {
    "key": "def",
    "label": "默认",
    "count": 15
  },
  {
    "key": "dyn",
    "label": "动态",
    "count": 10
  },
  {
    "key": "special",
    "label": "纪念",
    "count": 89
  },
  {
    "key": "activity",
    "label": "活动",
    "count": 89
  }
] as const;

export const PLAYER_AVATARS: readonly PlayerAvatar[] = [
  {
    "id": "pa:avatar_activity_AC_1",
    "file": "avatar_activity_AC_1.png",
    "label": "活动 AC_1",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_AC_2",
    "file": "avatar_activity_AC_2.png",
    "label": "活动 AC_2",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_AC",
    "file": "avatar_activity_AC.png",
    "label": "活动 AC",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_AF",
    "file": "avatar_activity_AF.png",
    "label": "活动 AF",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_ARC1",
    "file": "avatar_activity_ARC1.png",
    "label": "活动 ARC1",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_AS",
    "file": "avatar_activity_AS.png",
    "label": "活动 AS",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_AW",
    "file": "avatar_activity_AW.png",
    "label": "活动 AW",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_BB",
    "file": "avatar_activity_BB.png",
    "label": "活动 BB",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_BH",
    "file": "avatar_activity_BH.png",
    "label": "活动 BH",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_BI",
    "file": "avatar_activity_BI.png",
    "label": "活动 BI",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_BN",
    "file": "avatar_activity_BN.png",
    "label": "活动 BN",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_BP",
    "file": "avatar_activity_BP.png",
    "label": "活动 BP",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_CB",
    "file": "avatar_activity_CB.png",
    "label": "活动 CB",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_CR",
    "file": "avatar_activity_CR.png",
    "label": "活动 CR",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_CV",
    "file": "avatar_activity_CV.png",
    "label": "活动 CV",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_CW",
    "file": "avatar_activity_CW.png",
    "label": "活动 CW",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_DC",
    "file": "avatar_activity_DC.png",
    "label": "活动 DC",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_DH",
    "file": "avatar_activity_DH.png",
    "label": "活动 DH",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_dp1",
    "file": "avatar_activity_dp1.png",
    "label": "活动 dp1",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_DT",
    "file": "avatar_activity_DT.png",
    "label": "活动 DT",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_DV",
    "file": "avatar_activity_DV.png",
    "label": "活动 DV",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_ED_1",
    "file": "avatar_activity_ED_1.png",
    "label": "活动 ED_1",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_ED2",
    "file": "avatar_activity_ED2.png",
    "label": "活动 ED2",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_ED3",
    "file": "avatar_activity_ED3.png",
    "label": "活动 ED3",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_EP10_1",
    "file": "avatar_activity_EP10_1.png",
    "label": "活动 EP10_1",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_EP10_2",
    "file": "avatar_activity_EP10_2.png",
    "label": "活动 EP10_2",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_EP11",
    "file": "avatar_activity_EP11.png",
    "label": "活动 EP11",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_EP12",
    "file": "avatar_activity_EP12.png",
    "label": "活动 EP12",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_EP13",
    "file": "avatar_activity_EP13.png",
    "label": "活动 EP13",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_EP14",
    "file": "avatar_activity_EP14.png",
    "label": "活动 EP14",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_FA",
    "file": "avatar_activity_FA.png",
    "label": "活动 FA",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_FC",
    "file": "avatar_activity_FC.png",
    "label": "活动 FC",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_FD",
    "file": "avatar_activity_FD.png",
    "label": "活动 FD",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_GA",
    "file": "avatar_activity_GA.png",
    "label": "活动 GA",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_GK",
    "file": "avatar_activity_GK.png",
    "label": "活动 GK",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_GO",
    "file": "avatar_activity_GO.png",
    "label": "活动 GO",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_HE",
    "file": "avatar_activity_HE.png",
    "label": "活动 HE",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_HLL",
    "file": "avatar_activity_HLL.png",
    "label": "活动 HLL",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_HP",
    "file": "avatar_activity_HP.png",
    "label": "活动 HP",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_HS",
    "file": "avatar_activity_HS.png",
    "label": "活动 HS",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_IC",
    "file": "avatar_activity_IC.png",
    "label": "活动 IC",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_IS",
    "file": "avatar_activity_IS.png",
    "label": "活动 IS",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_IW",
    "file": "avatar_activity_IW.png",
    "label": "活动 IW",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_KR",
    "file": "avatar_activity_KR.png",
    "label": "活动 KR",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_LE",
    "file": "avatar_activity_LE.png",
    "label": "活动 LE",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_MB",
    "file": "avatar_activity_MB.png",
    "label": "活动 MB",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_MN",
    "file": "avatar_activity_MN.png",
    "label": "活动 MN",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_mujica",
    "file": "avatar_activity_mujica.png",
    "label": "活动 mujica",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_MULTI2",
    "file": "avatar_activity_MULTI2.png",
    "label": "活动 MULTI2",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_NL",
    "file": "avatar_activity_NL.png",
    "label": "活动 NL",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_OF",
    "file": "avatar_activity_OF.png",
    "label": "活动 OF",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_OI",
    "file": "avatar_activity_OI.png",
    "label": "活动 OI",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_pcAct",
    "file": "avatar_activity_pcAct.png",
    "label": "活动 pcAct",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_PL",
    "file": "avatar_activity_PL.png",
    "label": "活动 PL",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_PS",
    "file": "avatar_activity_PS.png",
    "label": "活动 PS",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_RE",
    "file": "avatar_activity_RE.png",
    "label": "活动 RE",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_RI",
    "file": "avatar_activity_RI.png",
    "label": "活动 RI",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_RL1_1",
    "file": "avatar_activity_RL1_1.png",
    "label": "活动 RL1_1",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_RL1_2",
    "file": "avatar_activity_RL1_2.png",
    "label": "活动 RL1_2",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_RL2_1",
    "file": "avatar_activity_RL2_1.png",
    "label": "活动 RL2_1",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_RL2_2",
    "file": "avatar_activity_RL2_2.png",
    "label": "活动 RL2_2",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_RL3_1",
    "file": "avatar_activity_RL3_1.png",
    "label": "活动 RL3_1",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_RL3_2",
    "file": "avatar_activity_RL3_2.png",
    "label": "活动 RL3_2",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_RL4_1",
    "file": "avatar_activity_RL4_1.png",
    "label": "活动 RL4_1",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_RL4_2",
    "file": "avatar_activity_RL4_2.png",
    "label": "活动 RL4_2",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_RL4_3",
    "file": "avatar_activity_RL4_3.png",
    "label": "活动 RL4_3",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_RL5_1",
    "file": "avatar_activity_RL5_1.png",
    "label": "活动 RL5_1",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_RL5_2",
    "file": "avatar_activity_RL5_2.png",
    "label": "活动 RL5_2",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_RS",
    "file": "avatar_activity_RS.png",
    "label": "活动 RS",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_SA",
    "file": "avatar_activity_SA.png",
    "label": "活动 SA",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_SB1_1",
    "file": "avatar_activity_SB1_1.png",
    "label": "活动 SB1_1",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_SL",
    "file": "avatar_activity_SL.png",
    "label": "活动 SL",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_SN",
    "file": "avatar_activity_SN.png",
    "label": "活动 SN",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_SV",
    "file": "avatar_activity_SV.png",
    "label": "活动 SV",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_SYS",
    "file": "avatar_activity_SYS.png",
    "label": "活动 SYS",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_TB",
    "file": "avatar_activity_TB.png",
    "label": "活动 TB",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_TC",
    "file": "avatar_activity_TC.png",
    "label": "活动 TC",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_TG",
    "file": "avatar_activity_TG.png",
    "label": "活动 TG",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_TW",
    "file": "avatar_activity_TW.png",
    "label": "活动 TW",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_UT",
    "file": "avatar_activity_UT.png",
    "label": "活动 UT",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_VEC1",
    "file": "avatar_activity_VEC1.png",
    "label": "活动 VEC1",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_VI",
    "file": "avatar_activity_VI.png",
    "label": "活动 VI",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_WB",
    "file": "avatar_activity_WB.png",
    "label": "活动 WB",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_WD",
    "file": "avatar_activity_WD.png",
    "label": "活动 WD",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_WR",
    "file": "avatar_activity_WR.png",
    "label": "活动 WR",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_XB1_1",
    "file": "avatar_activity_XB1_1.png",
    "label": "活动 XB1_1",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_XB1_2",
    "file": "avatar_activity_XB1_2.png",
    "label": "活动 XB1_2",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_XB2_1",
    "file": "avatar_activity_XB2_1.png",
    "label": "活动 XB2_1",
    "group": "activity"
  },
  {
    "id": "pa:avatar_activity_ZT",
    "file": "avatar_activity_ZT.png",
    "label": "活动 ZT",
    "group": "activity"
  },
  {
    "id": "pa:avatar_def_01",
    "file": "avatar_def_01.png",
    "label": "默认 01",
    "group": "def"
  },
  {
    "id": "pa:avatar_def_02",
    "file": "avatar_def_02.png",
    "label": "默认 02",
    "group": "def"
  },
  {
    "id": "pa:avatar_def_03",
    "file": "avatar_def_03.png",
    "label": "默认 03",
    "group": "def"
  },
  {
    "id": "pa:avatar_def_04",
    "file": "avatar_def_04.png",
    "label": "默认 04",
    "group": "def"
  },
  {
    "id": "pa:avatar_def_05",
    "file": "avatar_def_05.png",
    "label": "默认 05",
    "group": "def"
  },
  {
    "id": "pa:avatar_def_06",
    "file": "avatar_def_06.png",
    "label": "默认 06",
    "group": "def"
  },
  {
    "id": "pa:avatar_def_07",
    "file": "avatar_def_07.png",
    "label": "默认 07",
    "group": "def"
  },
  {
    "id": "pa:avatar_def_08",
    "file": "avatar_def_08.png",
    "label": "默认 08",
    "group": "def"
  },
  {
    "id": "pa:avatar_def_09",
    "file": "avatar_def_09.png",
    "label": "默认 09",
    "group": "def"
  },
  {
    "id": "pa:avatar_def_10",
    "file": "avatar_def_10.png",
    "label": "默认 10",
    "group": "def"
  },
  {
    "id": "pa:avatar_def_11",
    "file": "avatar_def_11.png",
    "label": "默认 11",
    "group": "def"
  },
  {
    "id": "pa:avatar_def_12",
    "file": "avatar_def_12.png",
    "label": "默认 12",
    "group": "def"
  },
  {
    "id": "pa:avatar_def_13",
    "file": "avatar_def_13.png",
    "label": "默认 13",
    "group": "def"
  },
  {
    "id": "pa:avatar_def_14",
    "file": "avatar_def_14.png",
    "label": "默认 14",
    "group": "def"
  },
  {
    "id": "pa:avatar_def_15",
    "file": "avatar_def_15.png",
    "label": "默认 15",
    "group": "def"
  },
  {
    "id": "pa:avatar_dyn_01",
    "file": "avatar_dyn_01.png",
    "label": "动态 01",
    "group": "dyn"
  },
  {
    "id": "pa:avatar_dyn_02",
    "file": "avatar_dyn_02.png",
    "label": "动态 02",
    "group": "dyn"
  },
  {
    "id": "pa:avatar_dyn_03",
    "file": "avatar_dyn_03.png",
    "label": "动态 03",
    "group": "dyn"
  },
  {
    "id": "pa:avatar_dyn_04",
    "file": "avatar_dyn_04.png",
    "label": "动态 04",
    "group": "dyn"
  },
  {
    "id": "pa:avatar_dyn_05",
    "file": "avatar_dyn_05.png",
    "label": "动态 05",
    "group": "dyn"
  },
  {
    "id": "pa:avatar_dyn_06",
    "file": "avatar_dyn_06.png",
    "label": "动态 06",
    "group": "dyn"
  },
  {
    "id": "pa:avatar_dyn_07",
    "file": "avatar_dyn_07.png",
    "label": "动态 07",
    "group": "dyn"
  },
  {
    "id": "pa:avatar_dyn_08",
    "file": "avatar_dyn_08.png",
    "label": "动态 08",
    "group": "dyn"
  },
  {
    "id": "pa:avatar_dyn_1000day",
    "file": "avatar_dyn_1000day.png",
    "label": "动态 1000day",
    "group": "dyn"
  },
  {
    "id": "pa:avatar_dyn_360day",
    "file": "avatar_dyn_360day.png",
    "label": "动态 360day",
    "group": "dyn"
  },
  {
    "id": "pa:avatar_special_01",
    "file": "avatar_special_01.png",
    "label": "纪念 01",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_02",
    "file": "avatar_special_02.png",
    "label": "纪念 02",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_03",
    "file": "avatar_special_03.png",
    "label": "纪念 03",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_04",
    "file": "avatar_special_04.png",
    "label": "纪念 04",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_05",
    "file": "avatar_special_05.png",
    "label": "纪念 05",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_06",
    "file": "avatar_special_06.png",
    "label": "纪念 06",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_07",
    "file": "avatar_special_07.png",
    "label": "纪念 07",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_08",
    "file": "avatar_special_08.png",
    "label": "纪念 08",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_09",
    "file": "avatar_special_09.png",
    "label": "纪念 09",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_10",
    "file": "avatar_special_10.png",
    "label": "纪念 10",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_11",
    "file": "avatar_special_11.png",
    "label": "纪念 11",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_12",
    "file": "avatar_special_12.png",
    "label": "纪念 12",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_13",
    "file": "avatar_special_13.png",
    "label": "纪念 13",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_14",
    "file": "avatar_special_14.png",
    "label": "纪念 14",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_15",
    "file": "avatar_special_15.png",
    "label": "纪念 15",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_16",
    "file": "avatar_special_16.png",
    "label": "纪念 16",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_17",
    "file": "avatar_special_17.png",
    "label": "纪念 17",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_18",
    "file": "avatar_special_18.png",
    "label": "纪念 18",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_19",
    "file": "avatar_special_19.png",
    "label": "纪念 19",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_20",
    "file": "avatar_special_20.png",
    "label": "纪念 20",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_21",
    "file": "avatar_special_21.png",
    "label": "纪念 21",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_22",
    "file": "avatar_special_22.png",
    "label": "纪念 22",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_23",
    "file": "avatar_special_23.png",
    "label": "纪念 23",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_24",
    "file": "avatar_special_24.png",
    "label": "纪念 24",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_25",
    "file": "avatar_special_25.png",
    "label": "纪念 25",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_26",
    "file": "avatar_special_26.png",
    "label": "纪念 26",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_27",
    "file": "avatar_special_27.png",
    "label": "纪念 27",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_28",
    "file": "avatar_special_28.png",
    "label": "纪念 28",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_29",
    "file": "avatar_special_29.png",
    "label": "纪念 29",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_30",
    "file": "avatar_special_30.png",
    "label": "纪念 30",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_31",
    "file": "avatar_special_31.png",
    "label": "纪念 31",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_32",
    "file": "avatar_special_32.png",
    "label": "纪念 32",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_33",
    "file": "avatar_special_33.png",
    "label": "纪念 33",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_34",
    "file": "avatar_special_34.png",
    "label": "纪念 34",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_35",
    "file": "avatar_special_35.png",
    "label": "纪念 35",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_36",
    "file": "avatar_special_36.png",
    "label": "纪念 36",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_37",
    "file": "avatar_special_37.png",
    "label": "纪念 37",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_38",
    "file": "avatar_special_38.png",
    "label": "纪念 38",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_39",
    "file": "avatar_special_39.png",
    "label": "纪念 39",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_40",
    "file": "avatar_special_40.png",
    "label": "纪念 40",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_41",
    "file": "avatar_special_41.png",
    "label": "纪念 41",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_42",
    "file": "avatar_special_42.png",
    "label": "纪念 42",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_43",
    "file": "avatar_special_43.png",
    "label": "纪念 43",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_44",
    "file": "avatar_special_44.png",
    "label": "纪念 44",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_45",
    "file": "avatar_special_45.png",
    "label": "纪念 45",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_46",
    "file": "avatar_special_46.png",
    "label": "纪念 46",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_47",
    "file": "avatar_special_47.png",
    "label": "纪念 47",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_48",
    "file": "avatar_special_48.png",
    "label": "纪念 48",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_49",
    "file": "avatar_special_49.png",
    "label": "纪念 49",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_50",
    "file": "avatar_special_50.png",
    "label": "纪念 50",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_51",
    "file": "avatar_special_51.png",
    "label": "纪念 51",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_52",
    "file": "avatar_special_52.png",
    "label": "纪念 52",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_53",
    "file": "avatar_special_53.png",
    "label": "纪念 53",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_54",
    "file": "avatar_special_54.png",
    "label": "纪念 54",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_55",
    "file": "avatar_special_55.png",
    "label": "纪念 55",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_56",
    "file": "avatar_special_56.png",
    "label": "纪念 56",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_57",
    "file": "avatar_special_57.png",
    "label": "纪念 57",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_58",
    "file": "avatar_special_58.png",
    "label": "纪念 58",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_60",
    "file": "avatar_special_60.png",
    "label": "纪念 60",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_61",
    "file": "avatar_special_61.png",
    "label": "纪念 61",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_62",
    "file": "avatar_special_62.png",
    "label": "纪念 62",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_63",
    "file": "avatar_special_63.png",
    "label": "纪念 63",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_64",
    "file": "avatar_special_64.png",
    "label": "纪念 64",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_65",
    "file": "avatar_special_65.png",
    "label": "纪念 65",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_74",
    "file": "avatar_special_74.png",
    "label": "纪念 74",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_75",
    "file": "avatar_special_75.png",
    "label": "纪念 75",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_76",
    "file": "avatar_special_76.png",
    "label": "纪念 76",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_77",
    "file": "avatar_special_77.png",
    "label": "纪念 77",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_78",
    "file": "avatar_special_78.png",
    "label": "纪念 78",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_79",
    "file": "avatar_special_79.png",
    "label": "纪念 79",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_80",
    "file": "avatar_special_80.png",
    "label": "纪念 80",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_81",
    "file": "avatar_special_81.png",
    "label": "纪念 81",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_82",
    "file": "avatar_special_82.png",
    "label": "纪念 82",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_83",
    "file": "avatar_special_83.png",
    "label": "纪念 83",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_84",
    "file": "avatar_special_84.png",
    "label": "纪念 84",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_85",
    "file": "avatar_special_85.png",
    "label": "纪念 85",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_86",
    "file": "avatar_special_86.png",
    "label": "纪念 86",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_87",
    "file": "avatar_special_87.png",
    "label": "纪念 87",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_88",
    "file": "avatar_special_88.png",
    "label": "纪念 88",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_89",
    "file": "avatar_special_89.png",
    "label": "纪念 89",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_90",
    "file": "avatar_special_90.png",
    "label": "纪念 90",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_91",
    "file": "avatar_special_91.png",
    "label": "纪念 91",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_92",
    "file": "avatar_special_92.png",
    "label": "纪念 92",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_93",
    "file": "avatar_special_93.png",
    "label": "纪念 93",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_94",
    "file": "avatar_special_94.png",
    "label": "纪念 94",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_95",
    "file": "avatar_special_95.png",
    "label": "纪念 95",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_96",
    "file": "avatar_special_96.png",
    "label": "纪念 96",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_97",
    "file": "avatar_special_97.png",
    "label": "纪念 97",
    "group": "special"
  },
  {
    "id": "pa:avatar_special_MissC",
    "file": "avatar_special_MissC.png",
    "label": "纪念 MissC",
    "group": "special"
  }
];

/** 某个 id 是不是官方个人头像 */
export function isPlayerAvatarId(id: string | undefined | null): boolean {
  if (!id || !id.startsWith('pa:')) return false;
  return PLAYER_AVATARS.some((avatar) => avatar.id === id);
}

/** 按 id 取头像信息（找不到返回 undefined） */
export function playerAvatarOf(id: string | undefined | null): PlayerAvatar | undefined {
  if (!id) return undefined;
  return PLAYER_AVATARS.find((avatar) => avatar.id === id);
}
