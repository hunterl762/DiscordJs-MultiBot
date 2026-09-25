const { getPool } = require('../database');

async function addWarning(guildId,userId,moderatorId,reason){
  const [result]=await getPool().execute(
    'INSERT INTO warnings (guild_id,user_id,moderator_id,reason) VALUES (?,?,?,?)',
    [guildId,userId,moderatorId,String(reason).slice(0,1000)],
  );
  return result.insertId;
}
async function listWarnings(guildId,userId){
  const [rows]=await getPool().execute(
    'SELECT id,moderator_id,reason,created_at FROM warnings WHERE guild_id=? AND user_id=? ORDER BY created_at DESC LIMIT 25',
    [guildId,userId],
  );
  return rows;
}
async function clearWarnings(guildId,userId){
  const [result]=await getPool().execute('DELETE FROM warnings WHERE guild_id=? AND user_id=?',[guildId,userId]);
  return result.affectedRows;
}

function levelFromXp(xp){ return Math.floor(Math.sqrt(Number(xp||0)/100)); }
async function addMessageXp(guildId,userId,amount,cooldownSeconds){
  const [rows]=await getPool().execute('SELECT xp,last_message_xp_at FROM user_levels WHERE guild_id=? AND user_id=? LIMIT 1',[guildId,userId]);
  const row=rows[0];
  const now=Date.now();
  if(row?.last_message_xp_at && now-new Date(row.last_message_xp_at).getTime()<cooldownSeconds*1000) return null;
  const newXp=Number(row?.xp||0)+Number(amount||0);
  const level=levelFromXp(newXp);
  await getPool().execute(
    `INSERT INTO user_levels (guild_id,user_id,xp,level,message_count,last_message_xp_at)
     VALUES (?,?,?,?,1,NOW())
     ON DUPLICATE KEY UPDATE xp=?,level=?,message_count=message_count+1,last_message_xp_at=NOW()`,
    [guildId,userId,newXp,level,newXp,level],
  );
  return {xp:newXp,level};
}
async function addVoiceXp(guildId,userId,minutes,amount){
  const [rows]=await getPool().execute('SELECT xp FROM user_levels WHERE guild_id=? AND user_id=? LIMIT 1',[guildId,userId]);
  const newXp=Number(rows[0]?.xp||0)+Number(amount||0);
  const level=levelFromXp(newXp);
  await getPool().execute(
    `INSERT INTO user_levels (guild_id,user_id,xp,level,voice_minutes)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE xp=?,level=?,voice_minutes=voice_minutes+?`,
    [guildId,userId,newXp,level,minutes,newXp,level,minutes],
  );
  return {xp:newXp,level};
}
async function getRank(guildId,userId){
  const [rows]=await getPool().execute('SELECT xp,level,message_count,voice_minutes FROM user_levels WHERE guild_id=? AND user_id=? LIMIT 1',[guildId,userId]);
  const row=rows[0]||{xp:0,level:0,message_count:0,voice_minutes:0};
  const [rankRows]=await getPool().execute('SELECT COUNT(*)+1 AS rank_position FROM user_levels WHERE guild_id=? AND xp>?',[guildId,Number(row.xp||0)]);
  return {...row,rank:Number(rankRows[0]?.rank_position||1)};
}
async function leaderboard(guildId,limit=10){
  const [rows]=await getPool().execute('SELECT user_id,xp,level,message_count,voice_minutes FROM user_levels WHERE guild_id=? ORDER BY xp DESC LIMIT ?',[guildId,Number(limit)]);
  return rows;
}

async function getBalance(guildId,userId,startingBalance=0){
  await getPool().execute('INSERT IGNORE INTO economy_accounts (guild_id,user_id,balance) VALUES (?,?,?)',[guildId,userId,startingBalance]);
  const [rows]=await getPool().execute('SELECT balance,last_daily_at FROM economy_accounts WHERE guild_id=? AND user_id=? LIMIT 1',[guildId,userId]);
  return rows[0];
}
async function claimDaily(guildId,userId,startingBalance,dailyAmount){
  const account=await getBalance(guildId,userId,startingBalance);
  const now=Date.now();
  if(account.last_daily_at){
    const next=new Date(account.last_daily_at).getTime()+24*60*60*1000;
    if(now<next) return {ok:false,nextAt:new Date(next),balance:Number(account.balance)};
  }
  await getPool().execute('UPDATE economy_accounts SET balance=balance+?,last_daily_at=NOW() WHERE guild_id=? AND user_id=?',[dailyAmount,guildId,userId]);
  return {ok:true,balance:Number(account.balance)+Number(dailyAmount)};
}

async function createReminder(guildId,userId,channelId,message,dueAt){
  const [r]=await getPool().execute('INSERT INTO reminders (guild_id,user_id,channel_id,message,due_at) VALUES (?,?,?,?,?)',[guildId,userId,channelId,String(message).slice(0,1000),dueAt]);
  return r.insertId;
}
async function dueReminders(limit=100){
  const [rows]=await getPool().execute('SELECT * FROM reminders WHERE delivered_at IS NULL AND due_at<=NOW() ORDER BY due_at ASC LIMIT ?',[Number(limit)]);
  return rows;
}
async function markReminderDelivered(id){
  await getPool().execute('UPDATE reminders SET delivered_at=NOW() WHERE id=?',[id]);
}
async function trackCommandUsage(guildId,userId,commandName){
  await getPool().execute('INSERT INTO command_usage (guild_id,user_id,command_name) VALUES (?,?,?)',[guildId||null,userId,commandName]);
}
async function getAnalytics(guildId){
  const [totals]=await getPool().execute(
    `SELECT COUNT(*) AS uses,COUNT(DISTINCT user_id) AS users
       FROM command_usage WHERE guild_id=? AND used_at>=DATE_SUB(NOW(),INTERVAL 30 DAY)`,
    [guildId],
  );
  const [top]=await getPool().execute(
    `SELECT command_name,COUNT(*) AS uses FROM command_usage
      WHERE guild_id=? AND used_at>=DATE_SUB(NOW(),INTERVAL 30 DAY)
      GROUP BY command_name ORDER BY uses DESC LIMIT 10`,
    [guildId],
  );
  return {uses:Number(totals[0]?.uses||0),users:Number(totals[0]?.users||0),top};
}

module.exports={
  addWarning,listWarnings,clearWarnings,
  addMessageXp,addVoiceXp,getRank,leaderboard,
  getBalance,claimDaily,
  createReminder,dueReminders,markReminderDelivered,
  trackCommandUsage,getAnalytics,
};
