'use strict';

const SmsSender = require('./lib/smsSender');
const smsSender = SmsSender();

smsSender.sendDailySms();