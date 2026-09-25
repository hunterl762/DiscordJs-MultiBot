const crypto = require('node:crypto');
const { getPool } = require('../database');
const { listSecureRecords, putSecureRecord, deleteSecureRecord } = require('../dashboardSecureStore');

const NS = 'automation';

function toRuntime(item) {
  return {
    id: item.id,
    guild_id: item.guildId,
    name: item.name,
    trigger_type: item.triggerType,
    trigger_value: item.triggerValue || '',
    action_type: item.actionType,
    action_channel_id: item.actionChannelId || '',
    action_role_id: item.actionRoleId || '',
    action_message: item.actionMessage || '',
    enabled: Boolean(item.enabled),
  };
}

async function migrateLegacy(guildId) {
  let rows = await listSecureRecords(guildId, NS);
  if (rows.length) return rows;
  const [legacy] = await getPool().execute('SELECT * FROM automation_rules WHERE guild_id=?', [guildId]);
  for (const row of legacy) {
    await putSecureRecord(guildId, NS, String(row.id), {
      id: String(row.id), guildId, name: row.name, triggerType: row.trigger_type,
      triggerValue: row.trigger_value || '', actionType: row.action_type,
      actionChannelId: row.action_channel_id || '', actionRoleId: row.action_role_id || '',
      actionMessage: row.action_message || '', enabled: Boolean(row.enabled),
    });
  }
  if (legacy.length) await getPool().execute('DELETE FROM automation_rules WHERE guild_id=?', [guildId]);
  return listSecureRecords(guildId, NS);
}

async function listAutomationRules(guildId) {
  return (await migrateLegacy(guildId))
    .map((row) => ({ ...row.payload, id: row.recordKey }))
    .sort((a, b) => String(b.id).localeCompare(String(a.id)));
}

async function listEnabledAutomationRules(guildId, triggerType) {
  return (await listAutomationRules(guildId))
    .filter((rule) => rule.enabled && rule.triggerType === triggerType)
    .map(toRuntime);
}

async function createAutomationRule(guildId, rule) {
  const id = crypto.randomUUID();
  await putSecureRecord(guildId, NS, id, {
    id, guildId,
    name: String(rule.name || 'Automation').slice(0, 80),
    triggerType: rule.triggerType,
    triggerValue: String(rule.triggerValue || '').slice(0, 500),
    actionType: rule.actionType,
    actionChannelId: String(rule.actionChannelId || '').slice(0, 32),
    actionRoleId: String(rule.actionRoleId || '').slice(0, 32),
    actionMessage: String(rule.actionMessage || '').slice(0, 1500),
    enabled: true,
  });
  return id;
}

async function deleteAutomationRule(guildId, id) {
  return deleteSecureRecord(guildId, NS, id);
}

module.exports = { listAutomationRules, listEnabledAutomationRules, createAutomationRule, deleteAutomationRule };
