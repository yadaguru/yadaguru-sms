'use strict';

const env = process.env.NODE_ENV || 'development';
const config = require('./config/config.json')[env];
const yadaguruData = require('yadaguru-data')(config);
const yadaguruReminders = require('yadaguru-reminders')(config);
const moment = require('moment');
const _ = require('underscore');
const models = yadaguruData.models;

module.exports = function() {

  /**
   * Twilio `from` phone number
   */
  const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || false;

  /**
   * Twilio API credentials
   */
  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || false;
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || false;

  /**
   * If provided, all text messages will be sent to this number, regardless of the 
   * user's actual phone number.
   */
  const TEST_NUMBER = processs.env.TEST_NUMBER || false;

  /**
   * The date of reminders to process. Defaults to today's date.
   */
  const PROCESS_DATE = process.env.PROCESS_DATE || moment.utc().format();

  /**
   * Interval (in ms) between processing messages on the queue.
   */
  const MESSAGE_INTERVAL = process.env.MESSAGE_INTERVAL || 5000;

  /**
   * The domain to use in the message shortlink
   */
  const APP_DOMAIN = process.env.APP_DOMAIN || 'yadaguru.com';

  /**
   * Queue of reminders to send
   */
  let reminderQueue = [];

  const smsSender = {};

  /**
   * Initiates the SMS sending process, and exits when completed.
   */
  smsSender.sendDailySms = function() {
    getReminders(PROCESS_DATE).then(reminders => {
      const groupedReminders = _.groupBy(reminders, 'userId');

      _.each(groupedReminders, reminderGroup => {
        reminderQueue.push(reminderGroup);
      });

      processQueue(() => process.exit(0));
    });
  };

  /**
   * Gets reminders for the given date
   * @param {moment}
   * @returns {Object[]}
   * Returns an array of objects with the following shape:
   *   id: the reminder id
   *   userId: the associated user id
   *   baseReminderId: the associated base reminder id
   *   smsMessage: the 28 (max) char message to send for the reminder
   *   phoneNumber: the user's phone number
   */
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

  /**
   * Processes items in the reminderQueue
   * @param {function} done - callback to invoke after queue has been processed
   */
  function processQueue(done) {
    if (reminderQueue.length === 0) {
      return done();
    }

    const userReminders = reminderQueue.pop();
    const message = createMessage(userReminders);
    sendMessage(message).then(() => {
      markRemindersAsSent(userReminders).then(() => {
        setTimeout(() => {
          processQueue(done);
        }, MESSAGE_INTERVAL);
      });
    });
  }

  /**
   * Creates an SMS message given an array of reminders. Will display up to 4 reminders.
   * If there are more than 4 reminders, only 3 will be shown, and a message indicating 
   * more reminders will be added. Messages will have the following format:
   * 
   * ```
   * Yadguru Reminders:             23 chars + newline char (18/18)
   * Reminder number 1 message!!    28 chars + newline char (29/47)
   * Reminder number 2 message!!    28 chars + newline char (29/76)
   * Reminder number 3 message!!    28 chars + newline char (29/105)
   * Reminder number 4 message!!    28 chars + newline char (29/134)
   *             -- OR - if more than 4 messages --
   * plus X more                    11 chars + newline char (12/117)
   * yadaguru.com/UUU-YYYYMMDD      25 chars (25/149)
   * ```
   * 
   * @param {Object[]} reminders - an array of reminders to process
   * @returns {Object} = A object with text and phoneNumber properties
   */
  function createMessage(reminders) {
    const deDupedReminders = removeDuplicates(reminders);
    let message = { phoneNumber: reminders[0].phoneNumber };
    const reminderCount = reminders.length;

    message.text = 'Yadaguru Reminders Due!\n';

    // get the first three messages
    for (let i = 0; i < reminderCount; i++) {
      if (i === 3) {
        break;
      }
      message.text += reminders[i].smsMessage + '\n'
    }

    // get the 4th message (if there are only 4)
    if (reminderCount === 4) {
      message.text += reminders[4].smsMessage + '\n'
    }

    // get message indicating more messages
    if (reminderCount > 4) {
      message.text += `Plus ${reminderCount - 3} more\n`
    }

    message.text += getShortlink(reminders[0].userId);

    return message

  }

  /**
   * Sends a message via Twilio
   * @param {Object} message - the message to send.
   * @returns {Promise}
   */
  function sendMessage(message) {
    // if Twilio credentials are not provided, don't send the message, just log it.
    if (!TWILIO_PHONE_NUMBER || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      console.log(message.phoneNumber);
      console.log(message.text);
      return Promise.resolve();
    }

    // If test number is provided, route the message to this number
    if (TEST_NUMBER) {
      message.phoneNumber = TEST_NUMBER;
    }

    return twilio.messages.create({
      to: '+1' + message.phoneNumber,
      from: '+1' + TWILIO_PHONE_NUMBER,
      body: message.text
    });
  }

  /**
   * Updates the array of reminders isSent columns to `false`
   * @param {Object[]} reminders
   * @returns {Promise}
   */
  function markRemindersAsSent(reminders) {
    const reminderIds = getReminderIds(reminders);

    return models.Reminder.update({ isSent: 'true' }, {
      where: { id: { $in: reminderIds } }
    })
  }

  /**
   * Returns an array of reminder ids, given an array of reminder objects.
   * @param {Object[]} reminders
   * @return {String[]} - an array of reminder ids
   */
  function getReminderIds(reminders) {
    return reminders.map(reminder => {
      return reminder.id;
    })
  }

  /**
   * Removes duplicate messages (messages with the same user and baseReminder IDs) from
   * an array of reminders.
   * @param {Object[]} reminders
   * @returns {Object[]}
   */
  function removeDuplicates(reminders) {
    reminders = _.sortBy(_.sortBy(reminders, 'baseReminderId'), 'userId');

    return reminders.reduce((deDuped, reminder) => {
      const previousReminder = _.isEmpty(deDuped) ? { userId: null, baseReminderId: null } : _.last(deDuped);

      if (previousReminder.userId === reminder.userId && previousReminder.baseReminderId === reminder.baseReminderId) {
        return deDuped;
      }

      deDuped.push(reminder);
      return deDuped;
    }, [])
  }

  /**
   * Gets the link to the daily reminders for the user.
   * Link format is domain/U-YYYYMMDD, where U is the user's ID.
   * @param {String|Number} userId - the user's ID.
   * @returns {String} - the shortlink
   */
  function getShortlink(userId) {
    const date = moment.utc(PROCESS_DATE).format('YYYYMMDD');
    return APP_DOMAIN + '/' + userId + '-' + date;
  }

  return smsSender;
}