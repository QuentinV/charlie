// Turning a composed automation's nodes into readable lines.
//
// No React, no DOM, no i18n bundle: `t` and the device-name lookup are passed
// in, so this stays pure — it sits next to the automations geometry
// (`layout.js`), and `index.jsx` only renders its result.

/**
 * The composed nodes are pushed triggers → actions → conditions, which is not
 * the order an automation reads, so the preview sorts them by kind.
 */
const KIND_ORDER = { trigger: 0, condition: 1, action: 2, notify: 2 };

const valueOf = (value) =>
    Array.isArray(value) ? value.join('–') : String(value ?? '');

/**
 * One readable line per understood step (`kind` + `detail`, already
 * translated). `nameOf` resolves a `deviceId` to its name; attributes stay in
 * HA's own vocabulary (`power`, `level`…), exactly as the graph draws them.
 */
export const draftSteps = (nodes, nameOf, t) => {
    const state = (deviceId, attribute, to) =>
        to === undefined
            ? t('automations.detailStateAny', {
                  device: nameOf(deviceId),
                  attribute,
              })
            : t('automations.detailState', {
                  device: nameOf(deviceId),
                  attribute,
                  value: valueOf(to),
              });

    return [...(nodes ?? [])]
        .sort(
            (a, b) =>
                (KIND_ORDER[a?.kind] ?? 3) - (KIND_ORDER[b?.kind] ?? 3)
        )
        .map((node) => {
            const id = node?.id;
            if (node?.kind === 'trigger') {
                const trigger = node.trigger ?? {};
                if (trigger.type === 'DEVICE_STATE') {
                    const device = trigger.device ?? {};
                    return {
                        id,
                        kind: t('automations.kind.trigger'),
                        detail: state(
                            device.deviceId,
                            device.attribute,
                            device.to
                        ),
                    };
                }
                if (trigger.type === 'CRON') {
                    return {
                        id,
                        kind: t('automations.kind.schedule'),
                        detail: t('automations.detailCron', {
                            cron: trigger.cron?.expression ?? '',
                        }),
                    };
                }
                if (trigger.type === 'EVENT') {
                    return {
                        id,
                        kind: t('automations.kind.event'),
                        detail: t('automations.detailEvent', {
                            event: trigger.event ?? '',
                        }),
                    };
                }
                return {
                    id,
                    kind: t('automations.kind.manual'),
                    detail: t('automations.detailManual'),
                };
            }
            if (node?.kind === 'condition') {
                const condition = node.condition ?? {};
                return {
                    id,
                    kind: t('automations.kind.condition'),
                    detail: t('automations.detailCondition', {
                        device: nameOf(condition.deviceId),
                        attribute: condition.attribute,
                        op: condition.op ?? '',
                        value: valueOf(condition.value),
                    }),
                };
            }
            if (node?.kind === 'notify') {
                return {
                    id,
                    kind: t('automations.kind.notify'),
                    detail: node.notify?.body ?? '',
                };
            }
            return {
                id,
                kind: t('automations.kind.action'),
                detail: node.action?.text ?? node.label ?? '',
            };
        });
};
