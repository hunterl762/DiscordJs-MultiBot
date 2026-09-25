const { getPool } = require('../database');

async function listAutomationRules(guildId) {
  const [rows] = await getPool().execute(
    `SELECT id,guild_id,name,trigger_type,trigger_value,action_type,action_channel_id,action_role_id,action_message,enabled,created_at,updated_at
       FROM automation_rules WHERE guild_id=? ORDER BY id DESC`,
    [guildId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    guildId: row.guild_id,
    name: row.name,
    triggerType: row.trigger_type,
    triggerValue: row.trigger_value || '',
    actionType: row.action_type,
    actionChannelId: row.action_channel_id || '',
    actionRoleId: row.action_role_id || '',
    actionMessage: row.action_message || '',
    enabled: Boolean(row.enabled),
  }));
}

async function listEnabledAutomationRules(guildId, triggerType) {
  const [rows] = await getPool().execute(
    `SELECT id,name,trigger_type,trigger_value,action_type,action_channel_id,action_role_id,action_message
       FROM automation_rules WHERE guild_id=? AND enabled=1 AND trigger_type=? ORDER BY id ASC`,
    [guildId, triggerType],
  );
  return rows;
}

async function createAutomationRule(guildId, rule) {
  const [result] = await getPool().execute(
    `INSERT INTO automation_rules
      (guild_id,name,trigger_type,trigger_value,action_type,action_channel_id,action_role_id,action_message,enabled)
     VALUES (?,?,?,?,?,?,?,?,1)`,
    [
      guildId,
      String(rule.name || 'Automation').slice(0, 80),
      rule.triggerType,
      String(rule.triggerValue || '').slice(0, 500),
      rule.actionType,
      String(rule.actionChannelId || '').slice(0, 32),
      String(rule.actionRoleId || '').slice(0, 32),
      String(rule.actionMessage || '').slice(0, 1500),
    ],
  );
  return String(result.insertId);
}

async function deleteAutomationRule(guildId, id) {
  const [result] = await getPool().execute('DELETE FROM automation_rules WHERE guild_id=? AND id=?', [guildId, id]);
  return result.affectedRows > 0;
}

module.exports = { listAutomationRules, listEnabledAutomationRules, createAutomationRule, deleteAutomationRule };
