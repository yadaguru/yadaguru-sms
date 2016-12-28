'use strict';

var env = process.env.NODE_ENV || 'development';
var config = require('./config/config.json')[env];
var yadaguruData = require('yadaguru-data')(config);
var yadaguruReminders = require('yadaguru-reminders')(config);
var moment = require('moment');
var _ = require('underscore');

const models = yadaguruData.models;

// TODO - yeah fix this...
const TWILIO_PHONE_NUMBER = '8562194474';
const TWILIO_ACCOUNT_SID = 'AC63c1660a0ee6e7341baf056b3e8eeb47';
const TWILIO_AUTH_TOKEN = '7c835fddcb444a5036aaa4c6c4d6b21e';
const USE_TWILIO = false; // Switch on an off for dev work.
const FORCE_TEST_NUMBER = true; // force to send everything to 6099229905;
var twilio;

if (USE_TWILIO) {
  twilio = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

//TODO this should be the current date.
var date = moment.utc('2016-12-03').format();

let reminderQueue = [];

getReminders(date).then(reminders => {
    // Group reminders by user
    const groupedReminders = _.groupBy(reminders, 'userId');

    // Push groups into queue
    _.each(groupedReminders, (reminderGroup) => {
      reminderQueue.push(reminderGroup);
    });

    processQueue(() => process.exit(0));
});

function getReminders(date) {
  return models.Reminder.findAll({
    where: {
      dueDate: date,
      isSent: false
    },
    include: [{
      model: models.BaseReminder,
      include: {
        model: models.Category
      }
    }, {
      model: models.User
    }],
    raw: true
  }).then(reminders => {
    return reminders.map(reminder => {
      return {
        id: reminder.id,
        userId: reminder['User.id'],
        baseReminderId: reminder.baseReminderId,
        smsMessage: reminder['BaseReminder.smsMessage'],
        phoneNumber: reminder['User.phoneNumber']
      };
    });
  });
}

function processQueue(done) {
  if (reminderQueue.length === 0) {
    return done();
  }

  const userReminders = reminderQueue.pop();
  const message = createMessage(userReminders);
  sendMessage(message).then(() => {
    markRemindersAsSent(userReminders).then(() => {
      // wait 5 seconds, then process the next user
      setTimeout(() => {
        processQueue(done);
      }, 5000);
    });
  });
}

function createMessage(reminders) {
  const deDupedReminders = removeDuplicates(reminders);
  let message = {phoneNumber: reminders[0].phoneNumber};
  const reminderCount = reminders.length;

  message.text = 'Yadaguru Reminders Due!\n'; // 24/24

  for (let i = 0; i < reminderCount; i++) {
    if (i === 3) {
      break;
    }
    message.text += reminders[i].smsMessage + '\n' // 29 * 3 max
  }

  if (reminderCount === 4) {
    message.text += reminders[4].smsMessage  + '\n' // 29 4th one
  } 

  if (reminderCount > 4) {
    message.text += `Plus ${reminderCount - 3} more\n` // 12
  }

  message.text += getShortlink(reminders[0].userId) // 25
  console.log('**MESSAGE LENGTH**', message.text.length);

  return message
}

function sendMessage(message) {
  if (!USE_TWILIO) {
    console.log(message);
    return Promise.resolve();
  }

  if (FORCE_TEST_NUMBER) {
    message.phoneNumber = '6099229905';
  }

  return twilio.messages.create({
    to: '+1' + message.phoneNumber,
    from: '+1' + TWILIO_PHONE_NUMBER,
    body: message.text
  });
}

function markRemindersAsSent(reminders) {
  const reminderIds = getReminderIds(reminders);

  return models.Reminder.update({isSent: 'true'}, {
    where: {id: {$in: reminderIds}}
  })
}

function getReminderIds(reminders) {
  return reminders.map(reminder => {
    return reminder.id;
  })
}

function removeDuplicates(reminders) {
  reminders = _.sortBy(_.sortBy(reminders, 'baseReminderId'), 'userId');

  return reminders.reduce((deDuped, reminder) => {
    const previousReminder = _.isEmpty(deDuped) ? {userId: null, baseReminderId: null} : _.last(deDuped);

    if (previousReminder.userId === reminder.userId && previousReminder.baseReminderId === reminder.baseReminderId) {
      return deDuped;
    }

    deDuped.push(reminder);
    return deDuped;
  }, [])
}


function getShortlink(userId) {
  const url = 'yadaguru.com' ;
  const date = moment.utc().format('YYYYMMDD');
  return url + '/' + userId + '-' + date;
}

`
Yadguru Reminders:             23 chars + newline char (18/18)
Reminder number 1 message!!    28 chars + newline char (29/47)
Reminder number 2 message!!    28 chars + newline char (29/76)
Reminder number 3 message!!    28 chars + newline char (29/105)
Reminder number 4 message!!    28 chars + newline char (29/134)
            -- OR - if more than 4 messages --
plus X more                    11 chars + newline char (12/117)
yadaguru.com/UUU-YYYYMMDD      25 chars (25/149)
`