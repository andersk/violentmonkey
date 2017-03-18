var _ = require('src/common');
var VMDB = require('./db');
var sync = require('./sync');
var requests = require('./requests');
var cache = require('./utils/cache');
var scriptUtils = require('./utils/script');
var clipboard = require('./utils/clipboard');
var options = require('./options');

var vmdb = exports.vmdb = new VMDB;
var VM_VER = browser.runtime.getManifest().version;

options.hook(function (changes) {
  if ('isApplied' in changes) {
    setIcon(changes.isApplied);
  }
  browser.runtime.sendMessage({
    cmd: 'UpdateOptions',
    data: changes,
  });
});

function broadcast(data) {
  browser.tabs.query({})
  .then(function (tabs) {
    tabs.forEach(function (tab) {
      browser.tabs.sendMessage(tab.id, data);
    });
  });
}

var autoUpdate = function () {
  function check() {
    checking = true;
    return new Promise(function (resolve, reject) {
      if (!options.get('autoUpdate')) return reject();
      if (Date.now() - options.get('lastUpdate') >= 864e5)
        resolve(commands.CheckUpdateAll());
    }).then(function () {
      setTimeout(check, 36e5);
    }, function () {
      checking = false;
    });
  }
  var checking;
  return function () {
    checking || check();
  };
}();
var commands = {
  NewScript: function (_data, _src) {
    return scriptUtils.newScript();
  },
  RemoveScript: function (id, _src) {
    return vmdb.removeScript(id)
    .then(function () {
      sync.sync();
    });
  },
  GetData: function (_data, _src) {
    return vmdb.getData().then(function (data) {
      data.sync = sync.states();
      data.version = VM_VER;
      return data;
    });
  },
  GetInjected: function (url, src) {
    var data = {
      isApplied: options.get('isApplied'),
      injectMode: options.get('injectMode'),
      version: VM_VER,
    };
    if (src.tab && src.url === src.tab.url) {
      browser.tabs.sendMessage(src.tab.id, {cmd: 'GetBadge'});
    }
    return data.isApplied
      ? vmdb.getScriptsByURL(url).then(function (res) {
        return Object.assign(data, res);
      }) : data;
  },
  UpdateScriptInfo: function (data, _src) {
    return vmdb.updateScriptInfo(data.id, data, {
      modified: Date.now(),
    })
    .then(function (script) {
      sync.sync();
      browser.runtime.sendMessage({
        cmd: 'UpdateScript',
        data: script,
      });
    });
  },
  SetValue: function (data, _src) {
    return vmdb.setValue(data.uri, data.values)
    .then(function () {
      broadcast({
        cmd: 'UpdateValues',
        data: {
          uri: data.uri,
          values: data.values,
        },
      });
    });
  },
  ExportZip: function (data, _src) {
    return vmdb.getExportData(data.ids, data.values);
  },
  GetScript: function (id, _src) {
    return vmdb.getScriptData(id);
  },
  GetMetas: function (ids, _src) {
    return vmdb.getScriptInfos(ids);
  },
  Move: function (data, _src) {
    return vmdb.moveScript(data.id, data.offset);
  },
  Vacuum: function (_data, _src) {
    return vmdb.vacuum();
  },
  ParseScript: function (data, _src) {
    return vmdb.parseScript(data).then(function (res) {
      var meta = res.data.meta;
      if (!meta.grant.length && !options.get('ignoreGrant'))
        notify({
          id: 'VM-NoGrantWarning',
          title: _.i18n('Warning'),
          body: _.i18n('msgWarnGrant', [meta.name||_.i18n('labelNoName')]),
          isClickable: true,
        });
      browser.runtime.sendMessage(res);
      sync.sync();
      return res.data;
    });
  },
  CheckUpdate: function (id, _src) {
    vmdb.getScript(id).then(vmdb.checkUpdate);
    return false;
  },
  CheckUpdateAll: function (_data, _src) {
    options.set('lastUpdate', Date.now());
    vmdb.getScriptsByIndex('update', 1).then(function (scripts) {
      return Promise.all(scripts.map(vmdb.checkUpdate));
    });
    return false;
  },
  ParseMeta: function (code, _src) {
    return scriptUtils.parseMeta(code);
  },
  AutoUpdate: autoUpdate,
  GetRequestId: function (_data, _src) {
    return requests.getRequestId();
  },
  HttpRequest: function (details, src) {
    requests.httpRequest(details, function (res) {
      browser.tabs.sendMessage(src.tab.id, {
        cmd: 'HttpRequested',
        data: res,
      });
    });
    return false;
  },
  AbortRequest: function (id, _src) {
    return requests.abortRequest(id);
  },
  SetBadge: function (num, src) {
    setBadge(num, src);
    return false;
  },
  SyncAuthorize: function (_data, _src) {
    sync.authorize();
    return false;
  },
  SyncRevoke: function (_data, _src) {
    sync.revoke();
    return false;
  },
  SyncStart: function (_data, _src) {
    sync.sync();
    return false;
  },
  GetFromCache: function (data, _src) {
    return cache.get(data) || null;
  },
  Notification: function (data, _src) {
    return new Promise(function (resolve) {
      browser.notifications.create({
        type: 'basic',
        title: data.title || _.i18n('extName'),
        message: data.text,
        iconUrl: data.image || _.defaultImage,
      })
      .then(function (id) {
        resolve(id);
      });
    });
  },
  SetClipboard: function (data, _src) {
    clipboard.set(data);
    return false;
  },
  OpenTab: function (data, _src) {
    browser.tabs.create({
      url: data.url,
      active: data.active,
    });
    return false;
  },
  GetAllOptions: function (_data, _src) {
    return options.getAll();
  },
  GetOptions: function (data, _src) {
    return data.reduce(function (res, key) {
      res[key] = options.get(key);
      return res;
    }, {});
  },
  SetOptions: function (data, _src) {
    if (!Array.isArray(data)) data = [data];
    data.forEach(function (item) {
      options.set(item.key, item.value);
    });
    return false;
  },
};

vmdb.initialized.then(function () {
  browser.runtime.onMessage.addListener(function (req, src) {
    var func = commands[req.cmd];
    if (func) {
      return func(req.data, src);
    }
  });
  setTimeout(autoUpdate, 2e4);
  sync.initialize();
});

// Common functions

function notify(options) {
  browser.notifications.create(options.id || 'ViolentMonkey', {
    type: 'basic',
    iconUrl: _.defaultImage,
    title: options.title + ' - ' + _.i18n('extName'),
    message: options.body,
    isClickable: options.isClickable,
  });
}

var setBadge = function () {
  var badges = {};
  return function (num, src) {
    var o = badges[src.id];
    if (!o) o = badges[src.id] = {num: 0};
    o.num += num;
    browser.browserAction.setBadgeBackgroundColor({
      color: '#808',
      tabId: src.tab.id,
    });
    var text = (options.get('showBadge') && o.num || '').toString();
    browser.browserAction.setBadgeText({
      text: text,
      tabId: src.tab.id,
    });
    if (o.timer) clearTimeout(o.timer);
    o.timer = setTimeout(function () {
      delete badges[src.id];
    }, 300);
  };
}();

function setIcon(isApplied) {
  browser.browserAction.setIcon({
    path: {
      19: '/public/images/icon19' + (isApplied ? '' : 'w') + '.png',
      38: '/public/images/icon38' + (isApplied ? '' : 'w') + '.png'
    },
  });
}
setIcon(options.get('isApplied'));

browser.notifications.onClicked.addListener(function (id) {
  if (id == 'VM-NoGrantWarning') {
    browser.tabs.create({
      url: 'http://wiki.greasespot.net/@grant',
    });
  } else {
    broadcast({
      cmd: 'NotificationClick',
      data: id,
    });
  }
});

browser.notifications.onClosed.addListener(function (id) {
  broadcast({
    cmd: 'NotificationClose',
    data: id,
  });
});
