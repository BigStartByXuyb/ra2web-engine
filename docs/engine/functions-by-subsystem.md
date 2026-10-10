# 函数分类（按子系统）

来源：`work/decompiled/ra2-engine/functions-detail.tsv`（Ghidra 12.1.4 导出，共 8078 个函数）。
分类依据：函数内部引用到的字符串常量与外部导入符号，不做语义猜测。

## 统计

| 子系统           | 函数数 |
| ---------------- | ------ |
| INI / 规则       | 45     |
| MIX 档案         | 12     |
| 美术素材         | 53     |
| 渲染 / 显示      | 26     |
| 音频             | 5      |
| 联机 / 网络      | 263    |
| 存档 / 回放      | 49     |
| 界面             | 31     |
| 地图             | 13     |
| 字符串表         | 0      |
| 未命中任何关键词 | 7643   |

## INI / 规则（45）

| 地址       | 名字           | 字节  | 命中字符串（节选）                         |
| ---------- | -------------- | ----- | ------------------------------------------ |
| `0068e280` | `FUN_0068e280` | 12400 | RA2.INI                                    |
| `00529870` | `FUN_00529870` | 6762  | %s.INI                                     |
| `005116a0` | `FUN_005116a0` | 4420  | EVA.INI ; Failed to find EVA.INI!          |
| `0065eb40` | `FUN_0065eb40` | 3642  | MISSION.INI ; TMCJ4F.INI                   |
| `0066f3a0` | `FUN_0066f3a0` | 3047  | RA2.INI                                    |
| `00579960` | `FUN_00579960` | 1897  | RMG.INI                                    |
| `00490510` | `FUN_00490510` | 1844  | CoopCamp.ini                               |
| `005b8490` | `FUN_005b8490` | 1838  | MPModes.ini                                |
| `005b0030` | `FUN_005b0030` | 1780  | Failed to load MAPSEL.INI ; MAPSEL.INI     |
| `005129c0` | `FUN_005129c0` | 1713  | AI.INI ; ART.INI                           |
| `005d8b00` | `FUN_005d8b00` | 1709  | --------- Loading SUN.INI settings -----   |
| `00744090` | `FUN_00744090` | 1404  | WDTMAP.INI                                 |
| `0048f040` | `FUN_0048f040` | 1355  | coopsave.ini                               |
| `0048eb30` | `FUN_0048eb30` | 1291  | coopsave.ini                               |
| `006433a0` | `FUN_006433a0` | 1092  | LANGRULE.INI                               |
| `0072d560` | `FUN_0072d560` | 1072  | WDTMAP.INI                                 |
| `00738880` | `FUN_00738880` | 960   | wolinfo.ini                                |
| `00670380` | `FUN_00670380` | 936   | RA2.INI                                    |
| `00725f40` | `FUN_00725f40` | 914   | WDTHist.INI                                |
| `0051a330` | `FUN_0051a330` | 854   | Failed to load UI.INI! ; UI.INI            |
| `007395d0` | `FUN_007395d0` | 836   | wolinfo.ini                                |
| `005d91b0` | `FUN_005d91b0` | 795   | RA2.INI                                    |
| `0048fe70` | `FUN_0048fe70` | 729   | coopsave.ini                               |
| `006469b0` | `FUN_006469b0` | 674   | CrateRules                                 |
| `0048fbf0` | `FUN_0048fbf0` | 640   | coopsave.ini                               |
| `00519240` | `FUN_00519240` | 562   | KEYBOARD.INI ; Unable to load KEYBOARD.INI |
| `00514ee0` | `FUN_00514ee0` | 539   | RA2.INI                                    |
| `00738670` | `FUN_00738670` | 524   | wolinfo.ini                                |
| `0063b090` | `FUN_0063b090` | 476   | MISSION.INI                                |
| `005127f0` | `FUN_005127f0` | 455   | BATTLE*.INI ; BATTLE.INI                   |
| `007263b0` | `FUN_007263b0` | 450   | WDTHist.ini                                |
| `007267c0` | `FUN_007267c0` | 359   | WDTHist.ini                                |
| `007390b0` | `FUN_007390b0` | 310   | wolinfo.ini                                |
| `00739330` | `FUN_00739330` | 310   | wolinfo.ini                                |
| `007391f0` | `FUN_007391f0` | 309   | wolinfo.ini                                |
| `00739470` | `FUN_00739470` | 309   | wolinfo.ini                                |
| `006525f0` | `FUN_006525f0` | 286   | CoopCamp.ini                               |
| `00738da0` | `FUN_00738da0` | 263   | wolinfo.ini                                |
| `00738cb0` | `FUN_00738cb0` | 238   | wolinfo.ini                                |
| `00738eb0` | `FUN_00738eb0` | 238   | wolinfo.ini                                |
| …          | 其余 5 个略    |       |                                            |

## MIX 档案（12）

| 地址       | 名字           | 字节  | 命中字符串（节选）                  |
| ---------- | -------------- | ----- | ----------------------------------- |
| `0068e280` | `FUN_0068e280` | 12400 | LANGUAGE.MIX                        |
| `00670c50` | `FUN_00670c50` | 2142  | *.MMX ; Can't see .pkt inside .mmx! |
| `00515e70` | `FUN_00515e70` | 1764  | CAMEO.MIX ; CONQUER.MIX             |
| `00744090` | `FUN_00744090` | 1404  | WDT.MIX                             |
| `00768e90` | `FUN_00768e90` | 1252  | Local.MIX ; WDT.MIX                 |
| `00519e70` | `FUN_00519e70` | 1012  | %s.MIX ; GENERIC.MIX                |
| `0051a330` | `FUN_0051a330` | 854   | SIDEC%02d.MIX ; SIDENC%02d.MIX      |
| `00515c90` | `FUN_00515c90` | 476   | CACHE.MIX ; LOCAL.MIX               |
| `00406ad0` | `FUN_00406ad0` | 426   | AUDIO.MIX                           |
| `00515af0` | `FUN_00515af0` | 406   | ECACHE*.MIX ; ELOCAL*.MIX           |
| `0051a2b0` | `FUN_0051a2b0` | 124   | LOADED NEUTRAL.MIX ; NEUTRAL.MIX    |
| `00535b90` | `FUN_00535b90` | 92    | LOAD.MIX                            |

## 美术素材（53）

| 地址       | 名字           | 字节  | 命中字符串（节选）              |
| ---------- | -------------- | ----- | ------------------------------- |
| `006daf60` | `FUN_006daf60` | 12659 | XXICON.SHP                      |
| `0064e6b0` | `FUN_0064e6b0` | 11217 | BOMBCURS.SHP                    |
| `004a6b90` | `FUN_004a6b90` | 10797 | CAMEO.PAL ; DGREEN1.SHP         |
| `00529870` | `FUN_00529870` | 6762  | C_SHADOW.SHP ; ISO%s.PAL        |
| `0073fee0` | `FUN_0073fee0` | 5096  | arbi.pcx ; djbi.pcx             |
| `005116a0` | `FUN_005116a0` | 4420  | ANIM.PAL ; CAMEO.PAL            |
| `00535bf0` | `FUN_00535bf0` | 3978  | ls%scuba.shp ; ls%sfrance.shp   |
| `00646c60` | `FUN_00646c60` | 3829  | BOMBCURS.SHP                    |
| `00729510` | `FUN_00729510` | 3440  | sdbtnanm.pal                    |
| `0057a0d0` | `FUN_0057a0d0` | 3086  | PROGBAR2.SHP                    |
| `00755180` | `FUN_00755180` | 2858  | wolclan.pcx ; wolob.pcx         |
| `0066bb20` | `FUN_0066bb20` | 2694  | PROGBARM.SHP                    |
| `005fc8a0` | `FUN_005fc8a0` | 2544  | arbi.pcx ; arrow_dd.pcx         |
| `006de260` | `FUN_006de260` | 2469  | XXICON.SHP                      |
| `0065c7d0` | `FUN_0065c7d0` | 1527  | PROGBARM.SHP ; SPLDBR.SHP       |
| `0066b520` | `FUN_0066b520` | 1524  | PROGBARM.SHP                    |
| `005bbdd0` | `FUN_005bbdd0` | 1516  | wolacpt.pcx ; wolhost.pcx       |
| `0073f8f0` | `FUN_0073f8f0` | 1505  | gt18.pcx ; wolclan.pcx          |
| `005434e0` | `FUN_005434e0` | 1414  | MOUSE.SHP                       |
| `006819a0` | `FUN_006819a0` | 1314  | SIDEGDI1.SHP ; SIDEGDI2.SHP     |
| `005fee70` | `FUN_005fee70` | 1281  | dbak6440.pcx                    |
| `006ab360` | `FUN_006ab360` | 1196  | MOUSE.SHP                       |
| `004de380` | `FUN_004de380` | 1173  | Title.PCX                       |
| `00519e70` | `FUN_00519e70` | 1012  | %s.PAL ; UNIT%s.PAL             |
| `005ca000` | `FUN_005ca000` | 933   | wolacpt.pcx ; wolhost.pcx       |
| `00516560` | `FUN_00516560` | 926   | GLS.PAL ; GLSL.SHP              |
| `00474510` | `FUN_00474510` | 794   | FOG.SHP                         |
| `00474260` | `FUN_00474260` | 675   | FOG.SHP ; SHROUD.SHP            |
| `00458600` | `FUN_00458600` | 576   | POWEROFF.SHP ; WRENCH.SHP       |
| `0067bd90` | `FUN_0067bd90` | 546   | ADDON.SHP ; GCLOCK2.SHP         |
| `005b3fd0` | `FUN_005b3fd0` | 542   | FULLFNT3.PAL ; FULLFNT3.SHP     |
| `00516900` | `FUN_00516900` | 505   | DPOD.HVA ; DPOD.VXL             |
| `005cd3f0` | `FUN_005cd3f0` | 328   | wolnob.pcx ; wolob.pcx          |
| `005c9ec0` | `FUN_005c9ec0` | 313   | wolacpt.pcx ; wolhost.pcx       |
| `005d5e00` | `FUN_005d5e00` | 311   | PIPBRD.SHP ; PIPS.SHP           |
| `004d1120` | `FUN_004d1120` | 270   | arbi.pcx ; djbi.pcx             |
| `00769790` | `FUN_00769790` | 260   | WDTFSAsm.pcx ; WDTFSBSm.pcx     |
| `0042e1a0` | `FUN_0042e1a0` | 231   | PBEACON.SHP ; RDRBEACN.SHP      |
| `00458510` | `FUN_00458510` | 229   | BUILDNGZ.SHP                    |
| `005fd960` | `FUN_005fd960` | 223   | gdnarrow%c.pcx ; guparrow%c.pcx |
| …          | 其余 13 个略   |       |                                 |

## 渲染 / 显示（26）

| 地址       | 名字               | 字节  | 命中字符串（节选）                                                    |
| ---------- | ------------------ | ----- | --------------------------------------------------------------------- |
| `006daf60` | `FUN_006daf60`     | 12659 | Palette ; You have violated the limit of having on                    |
| `005116a0` | `FUN_005116a0`     | 4420  | PALETTE.PAL                                                           |
| `00729510` | `FUN_00729510`     | 3440  | BackButtonPalette ; DefaultPalette                                    |
| `006de260` | `FUN_006de260`     | 2469  | Palette                                                               |
| `005b0030` | `FUN_005b0030`     | 1780  | Palette                                                               |
| `005434e0` | `FUN_005434e0`     | 1414  | Creating primary surface ; Deleting AlternateSurface                  |
| `006265c0` | `FUN_006265c0`     | 1377  | MEGAFRAMEINFO is part of a pserver port                               |
| `004aa660` | `FUN_004aa660`     | 1278  | CreateSurface OK ; CreateSurface failed with error code %08           |
| `0061e490` | `FUN_0061e490`     | 1176  | Created paletted preview of size %d byte                              |
| `0051a880` | `FUN_0051a880`     | 1129  | %d blits per second ; Profile: VRAM speed:%d (%d blits per sec        |
| `00519500` | `FUN_00519500`     | 1118  | Allocating new surfaces ; AlternateSurface (%dx%d) %s                 |
| `0042ff30` | `FUN_0042ff30`     | 759   | _BinkDDSurfaceType@4                                                  |
| `005c7970` | `FUN_005c7970`     | 704   | Creating the new preview surface                                      |
| `004df350` | `FUN_004df350`     | 669   | Palette                                                               |
| `005989b0` | `FUN_005989b0`     | 623   | Creating the new preview surface                                      |
| `00495c90` | `FUN_00495c90`     | 507   | CreatePalette ; CreatePalette failed                                  |
| `00495ad0` | `FUN_00495ad0`     | 439   | DDRAW.DLL Error code = %08X ; DDraw returnded actual VRAM of %d bytes |
| `0072dea0` | `FUN_0072dea0`     | 417   | TargetPalette                                                         |
| `004957e0` | `FUN_004957e0`     | 386   | Checking overlapped blit capability...                                |
| `00495970` | `FUN_00495970`     | 238   | DDRAW.DLL Error code = %08X ; DirectDrawCreate failed!                |
| `00495fc0` | `FUN_00495fc0`     | 218   | DDRAW.DLL Error code = %08X                                           |
| `00495e90` | `FUN_00495e90`     | 203   | DDRAW.DLL Error code = %08X                                           |
| `00495a60` | `FUN_00495a60`     | 108   | DDRAW.DLL Error code = %08X                                           |
| `00495770` | `FUN_00495770`     | 100   | DDRAW.DLL Error code = %08X                                           |
| `00482f80` | `FUN_00482f80`     | 57    | Surface                                                               |
| `00781bd8` | `DirectDrawCreate` | 6     | DirectDrawCreate                                                      |

## 音频（5）

| 地址       | 名字                | 字节  | 命中字符串（节选）                                            |
| ---------- | ------------------- | ----- | ------------------------------------------------------------- |
| `006daf60` | `FUN_006daf60`      | 12659 | ImpactLandSound                                               |
| `00643e10` | `FUN_00643e10`      | 11166 | AddPlanningModeCommandSound ; BuildingAbandonedSound          |
| `00667900` | `FUN_00667900`      | 344   | ScoreScreen: Loaded TEXT1.AUD ; ScoreScreen: Loaded TEXT2.AUD |
| `00715fb0` | `FUN_00715fb0`      | 238   | taunts\tauam%02i.wav ; taunts\taubr%02i.wav                   |
| `00781bde` | `DirectSoundCreate` | 6     | DirectSoundCreate                                             |

## 联机 / 网络（263）

| 地址       | 名字           | 字节  | 命中字符串（节选）                                                                 |
| ---------- | -------------- | ----- | ---------------------------------------------------------------------------------- |
| `0068e280` | `FUN_0068e280` | 12400 | Network ; Socket                                                                   |
| `0062a360` | `FUN_0062a360` | 11223 | FrameSendRate: %d ; Resends: %d                                                    |
| `005e22b0` | `FUN_005e22b0` | 9218  | STT:MainButtonNetwork ; STT:MainOptButtonNetwork                                   |
| `005c3ff0` | `FUN_005c3ff0` | 8191  | SendDlgItemMessageA ; SendMessageA                                                 |
| `005c08a0` | `FUN_005c08a0` | 6798  | SendDlgItemMessageA                                                                |
| `00624c10` | `FUN_00624c10` | 5519  | Resending progress message ; TXT_RECONNECTING_TO                                   |
| `00698d00` | `FUN_00698d00` | 5136  | Sending game results. SawCompletion=%d                                             |
| `0073fee0` | `FUN_0073fee0` | 5096  | SendDlgItemMessageA ; SendMessageA                                                 |
| `005bd070` | `FUN_005bd070` | 4915  | SendMessageA                                                                       |
| `005e5150` | `FUN_005e5150` | 3535  | SendMessageA                                                                       |
| `00540c20` | `FUN_00540c20` | 3507  | Sending chat, mask = %d ; TXT_CANT_SEND_BLANK_PAGE                                 |
| `00623b00` | `FUN_00623b00` | 3355  | Sending precalculated network timings on                                           |
| `0057a0d0` | `FUN_0057a0d0` | 3086  | SendMessageA                                                                       |
| `0066f3a0` | `FUN_0066f3a0` | 3047  | SendDelay                                                                          |
| `006829f0` | `FUN_006829f0` | 3047  | SendDlgItemMessageA ; SendMessageA                                                 |
| `00755180` | `FUN_00755180` | 2858  | SendMessageA                                                                       |
| `0066bb20` | `FUN_0066bb20` | 2694  | D:\Ra2\SendFile.CPP ; File info send timed out                                     |
| `00525f60` | `FUN_00525f60` | 2691  | Error - Connection %d has gone bad ; Set address for connection %d to %s           |
| `00599920` | `FUN_00599920` | 2535  | SendMessageA                                                                       |
| `005d09a0` | `FUN_005d09a0` | 2476  | Sending %s ; Sending data compression disable init                                 |
| `005ed180` | `FUN_005ed180` | 2461  | SendMessageA                                                                       |
| `0074e5e0` | `FUN_0074e5e0` | 2456  | Found old connection port number to use ; Got connection result - my packet must h |
| `00628880` | `FUN_00628880` | 2454  | FrameSendRate=%d ; Sending game results because I quit, but                        |
| `005ba2c0` | `FUN_005ba2c0` | 2447  | Netgear bug specified by command line or                                           |
| `0074f300` | `FUN_0074f300` | 2428  | Failed to verify connection paths ; FrameSendRate is %d                            |
| `0062dba0` | `FUN_0062dba0` | 2417  | FrameSendRate: %d ; Resends: %d                                                    |
| `00743720` | `FUN_00743720` | 2404  | SendDlgItemMessageA                                                                |
| `00482110` | `FUN_00482110` | 2346  | Sending NET_PORT_PROBE packets in Call_B ; Sending to %s                           |
| `00744a00` | `FUN_00744a00` | 2327  | TXT_CANT_CONNECT ; SendDlgItemMessageA                                             |
| `00526d90` | `FUN_00526d90` | 2208  | Resends : %d                                                                       |
| `00759e20` | `FUN_00759e20` | 2202  | SendMessageA                                                                       |
| `0075d330` | `FUN_0075d330` | 2195  | SendMessageA                                                                       |
| `007424c0` | `FUN_007424c0` | 2185  | TXT_CANT_CONNECT ; TXT_CONNECTING_SERVER                                           |
| `0053b770` | `FUN_0053b770` | 2068  | SendMessageA                                                                       |
| `00596540` | `FUN_00596540` | 2058  | SendMessageA                                                                       |
| `005cbf20` | `FUN_005cbf20` | 2003  | SendDlgItemMessageA ; SendMessageA                                                 |
| `00627b60` | `FUN_00627b60` | 1896  | Frame %d: Building Send Packet                                                     |
| `00741750` | `FUN_00741750` | 1858  | SendDlgItemMessageA                                                                |
| `00683fc0` | `FUN_00683fc0` | 1792  | SendDlgItemMessageA ; SendMessageA                                                 |
| `005d8b00` | `FUN_005d8b00` | 1709  | Network ; Socket                                                                   |
| …          | 其余 223 个略  |       |                                                                                    |

## 存档 / 回放（49）

| 地址       | 名字           | 字节 | 命中字符串（节选）                                    |
| ---------- | -------------- | ---- | ----------------------------------------------------- |
| `005e22b0` | `FUN_005e22b0` | 9218 | STT:GenerateButtonSaveMap ; STT:IGSingleOptButtonSave |
| `004b65c0` | `FUN_004b65c0` | 4994 | SAVEGAME.NET                                          |
| `006558b0` | `FUN_006558b0` | 4055 | OleSaveToStream                                       |
| `0053b770` | `FUN_0053b770` | 2068 | SAVE%04lX.%3s ; TXT_CONFIRM_SAVE                      |
| `006282d0` | `FUN_006282d0` | 1455 | Used old unit list in slot %d - %d bytes              |
| `0065dec0` | `FUN_0065dec0` | 1399 | TXT_TO_REPLAY                                         |
| `0048f040` | `FUN_0048f040` | 1355 | coopsave.ini                                          |
| `0048eb30` | `FUN_0048eb30` | 1291 | coopsave.ini                                          |
| `0048fe70` | `FUN_0048fe70` | 729  | coopsave.ini                                          |
| `0048fbf0` | `FUN_0048fbf0` | 640  | coopsave.ini                                          |
| `0059fc80` | `FUN_0059fc80` | 611  | OleSaveToStream                                       |
| `00660f60` | `FUN_00660f60` | 339  | Scenario Save: ElapsedTimer = %ld                     |
| `004c9fe0` | `FUN_004c9fe0` | 332  | OleSaveToStream                                       |
| `004b7bf0` | `FUN_004b7bf0` | 255  | Sorry, you can only attempt an emergency              |
| `0053c5c0` | `FUN_0053c5c0` | 129  | SAVEGAME.NET                                          |
| `006580c0` | `FUN_006580c0` | 127  | OleSaveToStream                                       |
| `00658140` | `FUN_00658140` | 127  | OleSaveToStream                                       |
| `006581c0` | `FUN_006581c0` | 127  | OleSaveToStream                                       |
| `00658240` | `FUN_00658240` | 127  | OleSaveToStream                                       |
| `006582c0` | `FUN_006582c0` | 127  | OleSaveToStream                                       |
| `00658340` | `FUN_00658340` | 127  | OleSaveToStream                                       |
| `006583c0` | `FUN_006583c0` | 127  | OleSaveToStream                                       |
| `00658440` | `FUN_00658440` | 127  | OleSaveToStream                                       |
| `006584c0` | `FUN_006584c0` | 127  | OleSaveToStream                                       |
| `00658540` | `FUN_00658540` | 127  | OleSaveToStream                                       |
| `006585c0` | `FUN_006585c0` | 127  | OleSaveToStream                                       |
| `00658640` | `FUN_00658640` | 127  | OleSaveToStream                                       |
| `006586c0` | `FUN_006586c0` | 127  | OleSaveToStream                                       |
| `00658740` | `FUN_00658740` | 127  | OleSaveToStream                                       |
| `006587c0` | `FUN_006587c0` | 127  | OleSaveToStream                                       |
| `00658840` | `FUN_00658840` | 127  | OleSaveToStream                                       |
| `006588c0` | `FUN_006588c0` | 127  | OleSaveToStream                                       |
| `00658940` | `FUN_00658940` | 127  | OleSaveToStream                                       |
| `006589c0` | `FUN_006589c0` | 127  | OleSaveToStream                                       |
| `00658a40` | `FUN_00658a40` | 127  | OleSaveToStream                                       |
| `00658ac0` | `FUN_00658ac0` | 127  | OleSaveToStream                                       |
| `00658b40` | `FUN_00658b40` | 127  | OleSaveToStream                                       |
| `00658bc0` | `FUN_00658bc0` | 127  | OleSaveToStream                                       |
| `00658c40` | `FUN_00658c40` | 127  | OleSaveToStream                                       |
| `00658cc0` | `FUN_00658cc0` | 127  | OleSaveToStream                                       |
| …          | 其余 9 个略    |      |                                                       |

## 界面（31）

| 地址       | 名字           | 字节  | 命中字符串（节选）                                         |
| ---------- | -------------- | ----- | ---------------------------------------------------------- |
| `0068e280` | `FUN_0068e280` | 12400 | MessageBoxA                                                |
| `005116a0` | `FUN_005116a0` | 4420  | TXT_CD_DIALOG_1                                            |
| `00599920` | `FUN_00599920` | 2535  | ModemHost.InitDialog(enter) ; ModemHost.InitDialog(exit)   |
| `00596540` | `FUN_00596540` | 2058  | ModemGuest.InitDialog(enter) ; ModemGuest.InitDialog(exit) |
| `005129c0` | `FUN_005129c0` | 1713  | DialogBoxParamA                                            |
| `005434e0` | `FUN_005434e0` | 1414  | GetMenu                                                    |
| `0059a310` | `FUN_0059a310` | 1383  | ModemHost.ReadDialog(enter) ; ModemHost.ReadDialog(exit)   |
| `0066cf60` | `FUN_0066cf60` | 1012  | Reading serial settings dialog                             |
| `0064b690` | `FUN_0064b690` | 872   | MultiplayerDialogSettings                                  |
| `00481bf0` | `FUN_00481bf0` | 780   | MessageBoxIndirectA                                        |
| `00495c90` | `FUN_00495c90` | 507   | MessageBoxA                                                |
| `0076b0a0` | `FUN_0076b0a0` | 486   | MessageBoxA                                                |
| `00737bd0` | `FUN_00737bd0` | 448   | CreateWindowExA ; GetMenu                                  |
| `00495ad0` | `FUN_00495ad0` | 439   | MessageBoxA                                                |
| `007163f0` | `FUN_007163f0` | 411   | DialogList                                                 |
| `00598e10` | `FUN_00598e10` | 398   | ModemHost.Dialog(enter) ; ModemHost.Dialog(exit %s)        |
| `00596010` | `FUN_00596010` | 351   | ModemGuest.Dialog(enter) ; ModemGuest.Dialog(exit %s)      |
| `005b5ee0` | `FUN_005b5ee0` | 286   | IsDialogMessageA                                           |
| `004b7bf0` | `FUN_004b7bf0` | 255   | WM_INITDIALOG ; EndDialog                                  |
| `004b7cf0` | `FUN_004b7cf0` | 239   | DialogBoxIndirectParamA ; DialogBoxParamA                  |
| `00495970` | `FUN_00495970` | 238   | MessageBoxA                                                |
| `00495fc0` | `FUN_00495fc0` | 218   | MessageBoxA                                                |
| `00735700` | `FUN_00735700` | 212   | CreateDialogIndirectParamA                                 |
| `00596d50` | `FUN_00596d50` | 210   | ModemGuest.ReadDialog(enter) ; ModemGuest.ReadDialog(exit) |
| `00495e90` | `FUN_00495e90` | 203   | MessageBoxA                                                |
| `005ff610` | `FUN_005ff610` | 193   | CreateDialogIndirectParamA                                 |
| `00768dd0` | `FUN_00768dd0` | 187   | TheaterChoice%sMenu                                        |
| `00793d0f` | `FUN_00793d0f` | 137   | MessageBoxA                                                |
| `006fa040` | `FUN_006fa040` | 115   | MessageBoxA                                                |
| `00495a60` | `FUN_00495a60` | 108   | MessageBoxA                                                |
| `00495770` | `FUN_00495770` | 100   | MessageBoxA                                                |

## 地图（13）

| 地址       | 名字           | 字节 | 命中字符串（节选）                       |
| ---------- | -------------- | ---- | ---------------------------------------- |
| `005e22b0` | `FUN_005e22b0` | 9218 | STT:GenerateCBoxTheater                  |
| `00529870` | `FUN_00529870` | 6762 | ToSnowTheater ; ToTemperateTheater       |
| `0057ae00` | `FUN_0057ae00` | 4175 | Theater                                  |
| `0065eb40` | `FUN_0065eb40` | 3642 | Theater                                  |
| `0049cfd0` | `FUN_0049cfd0` | 2358 | Theater                                  |
| `00670c50` | `FUN_00670c50` | 2142 | *.MPR                                    |
| `00577bd0` | `FUN_00577bd0` | 2097 | RandMap.Map                              |
| `00768e90` | `FUN_00768e90` | 1252 | WDTTheater%02.VQA                        |
| `00519e70` | `FUN_00519e70` | 1012 | Init theater %s                          |
| `005d7810` | `FUN_005d7810` | 959  | NewTheater ; Theater                     |
| `0052b2e0` | `FUN_0052b2e0` | 637  | Loaded %d isometric tiles consuming %d K |
| `0049d910` | `FUN_0049d910` | 581  | Theater                                  |
| `00768dd0` | `FUN_00768dd0` | 187  | TheaterChoice%sMenu                      |

## 字符串表（0）

| 地址 | 名字 | 字节 | 命中字符串（节选） |
| ---- | ---- | ---- | ------------------ |
