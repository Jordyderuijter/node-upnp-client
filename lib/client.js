'use strict'

var ssdp = require('node-ssdp'),
  xmlParser = require('xmldoc'),
  EE = require('events').EventEmitter,
  util = require('util'),
  dgram = require('dgram'),
  ip = require('ip'),
  http = require('http'),
  __ = require('underscore');

var PORT = 1900;
var HOST = ip.address();

function upnpClient() {
  var self = this

  if (!(this instanceof upnpClient)) return new upnpClient()

  EE.call(self)

  this._init()

}

util.inherits(upnpClient, EE)

upnpClient.prototype._init = function() {
  this._client = dgram.createSocket('udp4')
  this._client.bind(PORT);
  this._ssdp = new ssdp.Client()
  this._renderers = new Array()
  this._servers = new Array()
  this._avTransports = new Array()
  this._connectionManagers = new Array()
  this._udnList = new Array()
  this._contentServers = new Array()
  this._unknownDevices = new Array()
}

upnpClient.prototype._start = function() {
  var self = this

  self._ssdp.search('ssdp:all');

  self._client.on('notify', function(event) {
    console.log('Got a notification.', event)
  });

  self._client.on('listening', function() {
    var address = self._client.address();
    console.log('UDP Client listening on ' + address.address + ":" + address.port);
    self._client.setMulticastTTL(128);
    self._client.addMembership('239.255.255.250', HOST);
  });

  self._client.on('message', function(msg, rinfo) {
    self.parseDevice(msg);
  });

  self._ssdp.on('response', function(msg, rinfo) {
    self.parseDevice(msg);
  });

  self.on('deviceFound', function onMessage(device, type) {
    console.log("NEW " + type + " DEVICE FOUND: " + device.friendlyName + "\n");
    self.emit('updateUpnpDevice');
  })
}

/////////////  Search upnp Devices //////////////////

upnpClient.prototype.searchDevices = function() {

  console.log('STARTING DEVICES SEARCH....')

  // reinit arrays
  var self = this;
  self._start();

  self._renderers = new Array()
  self._servers = new Array()
  self._avTransports = new Array()
  self._connectionManagers = new Array()
  self._udnList = new Array()
  self._contentServers = new Array()
  self._unknownDevices = new Array()

  // emit terminated search signal after 10 seconds
  setTimeout(function() {
    self.emit('searchDevicesEnd');
  }, 10000);

};

//////// get renderers devices list /////////////

upnpClient.prototype.getRenderers = function() {
  return this._renderers;
}

//////// get servers devices list /////////////

upnpClient.prototype.getServers = function() {
  return this._servers;
}

//////// get servers avTransports list /////////////

upnpClient.prototype.getavTransports = function() {
  return this._avTransports;
}

//////// get content servers list /////////////

upnpClient.prototype.getContentServers = function() {
  return this._contentServers;
}

//////// get content servers list /////////////

upnpClient.prototype.getUnknownDevices = function() {
  return this._unknownDevices;
}

/////// get device control actions /////////////

upnpClient.prototype.getDeviceControlActions = function(device) {
  console.log('Actions list for device ' + device.friendlyName);
  var actionsList = [];
  device.services.forEach(function(service) {
    if (service.serviceType === "urn:schemas-upnp-org:service:RenderingControl:1") {
      var url = device.baseUrl + service.controlURL;
      http.get(url, function(res) {
        var doc = '';
        res.on('data', function(data) {
          doc += data.toString();
        });
        res.on('end', function() {
          //get actions list
          var xmldoc = new xmlParser.XmlDocument(doc);
          var actions;
          try {
            actions = xmldoc.childNamed("actionList").childrenNamed("action");
          } catch (err) {
            console.log("Invalid xml or URL not found at " + url);
            return {
              "result": "error",
              "msg": "Invalid xml or URL not found at " + url
            };
          }
          //var argsList = actions.childNamed("argumentList")
          // parse each actions
          actions.forEach(function(item) {
            var action = {};
            action.name = item.firstChild.val;
            console.log(action)
          });
        });
      });
    }
  })
}


upnpClient.prototype.parseDevice = function(msg) {
  var self = this;
  var deviceType = '';

  if (msg.toString().toLowerCase().indexOf('ssdp:byebye') !== -1) {
    var match = msg.toString().toLowerCase().match(/uuid:(.*?):/);
    var udn;
    if (match != undefined) {
      udn = 'uuid:' + match.pop();
    } else {
      console.log('Device does not have a uuid');
    }
    var list = [self._renderers, self._servers, self._avTransports, self._connectionManagers, self._contentServers, self._unknownDevices];
    list.forEach(function(typeArr, index1) {
        __.some(typeArr, function(el, index2) {
          if (el.udn === udn) {
            typeArr.pop(index2);
          }
        });
        if (index1 + 1 === list.length) {
          self.emit('updateUpnpDevice');
        }
      })
      // remove uuid
    __.some(self._udnList, function(el, index) {
      if (el === udn) {
        self._udnList.pop(index);
      }
    });

  } else {
    var location;
    try {
      location = msg.toString().match(/LOCATION: (.*)/)[1];
    } catch (err) {
      try {
        location = msg.toString().match(/Location: (.*)/)[1];
      } catch (err) {
        return;
      }
    }
    http.get(location, function(res) {
      var doc = '';
      res.on('data', function(data) {
        doc += data.toString();
      });
      res.on('end', function() {
        var xmldoc;
        try {
          xmldoc = new xmlParser.XmlDocument(doc);
        } catch (err) {
          console.log('Url ' + location + " do not contain valid xml...");
          return;
        }
        var dev = xmldoc.childNamed("device");

        if (self._udnList.indexOf(dev.childrenNamed("UDN")[0].val) !== -1) {
          //console.log('UDN' + dev.childrenNamed("UDN")[0].val + "already in list " + self._udnList)
          return;
        } else {
          self._udnList.push(dev.childrenNamed("UDN")[0].val);
        }
        // services
        var sList = dev.childNamed("serviceList");
        var servicesList = [];
        if (sList != undefined) {
          sList.eachChild(function(item) {
            var service = {};
            service.serviceType = item.childNamed('serviceType').val;
            service.serviceId = item.childNamed('serviceId').val;
            service.controlURL = item.childNamed('controlURL').val;
            service.eventSubURL = item.childNamed('eventSubURL').val;
            service.SCPDURL = item.childNamed('SCPDURL').val;
            var device = {};
            device.baseUrl = 'http://' + location.split('/')[2];
            //device.config = doc;
            device.udn = dev.childrenNamed("UDN")[0].val;
            device.modelName = dev.childrenNamed("modelName")[0].val;
            device.friendlyName = dev.childrenNamed("friendlyName")[0].val;

            var iconList = dev.childNamed("iconList")
            if (iconList != undefined) {
              device.icon = device.baseUrl + iconList.childrenNamed("icon")[0].childNamed('url').val;
            }
            device.online = true;
            device.onserviceoffline = false;
            device.onserviceonline = false;
            try {
              if (service.serviceType === "urn:schemas-upnp-org:service:ConnectionManager:1") {
                if (self._connectionManagers.push === 0) {
                  device._index = 0;
                } else {
                  device._index = self._connectionManagers.length;
                }
                device.id = device.udn + ':' + service.serviceType + service.serviceId;
                device.name = service.serviceId;
                device.type = "upnp:" + service.serviceType;
                device.url = device.baseUrl + service.controlURL;
                self._connectionManagers.push(device);
                deviceType = "CONNECTION MANAGER";
                self.emit('deviceFound', device, deviceType);
              } else if (service.serviceType === "urn:schemas-upnp-org:service:ContentDirectory:1") {
                if (self._servers.push === 0) {
                  device._index = 0;
                } else {
                  device._index = self._servers.length;
                }
                device.id = device.udn + ':' + service.serviceType + service.serviceId;
                device.name = service.serviceId;
                device.type = "upnp:" + service.serviceType;
                device.url = device.baseUrl + service.controlURL;
                self._servers.push(device);
                deviceType = "SERVER";
                self.emit('deviceFound', device, deviceType);
              } else if (service.serviceType === "urn:schemas-upnp-org:service:AVTransport:1") {
                if (self._avTransports.push === 0) {
                  device._index = 0;
                } else {
                  device._index = self._avTransports.length;
                }
                device.id = device.udn + ':' + service.serviceType + service.serviceId;
                device.name = service.serviceId;
                device.type = "upnp:" + service.serviceType;
                device.url = device.baseUrl + service.controlURL;
                self._avTransports.push(device);
                deviceType = "AVTRANSPORT";
                self.emit('deviceFound', device, deviceType);
              } else if (service.serviceType === "urn:schemas-upnp-org:service:RenderingControl:1") {
                if (self._renderers.push === 0) {
                  device._index = 0;
                } else {
                  device._index = self._renderers.length;
                }
                device.id = device.udn + ':' + service.serviceType + service.serviceId;
                device.name = service.serviceId;
                device.type = "upnp:" + service.serviceType;
                device.url = device.baseUrl + service.controlURL;
                self._renderers.push(device);
                deviceType = "RENDERER";
                self.emit('deviceFound', device, deviceType);
              } else if (service.serviceType === "urn:schemas-upnp-org:service:FourCastContent:1") {
                if (self._contentServers.push === 0) {
                  device._index = 0;
                } else {
                  device._index = self._contentServers.length;
                }
                device.id = device.udn + ':' + service.serviceType + service.serviceId;
                device.name = service.serviceId;
                device.type = "upnp:" + service.serviceType;
                device.url = device.baseUrl + service.controlURL;
                self._contentServers.push(device);
                deviceType = "CONTENT SERVER";
                self.emit('deviceFound', device, deviceType);
              } else {
                if (self._unknownDevices.push === 0) {
                  device._index = 0;
                } else {
                  device._index = self._unknownDevices.length;
                }
                device.id = device.udn + ':' + service.serviceType + service.serviceId;
                device.name = service.serviceId;
                device.type = "upnp:" + service.serviceType;
                device.url = device.baseUrl + service.controlURL;
                self._unknownDevices.push(device);
                deviceType = "UNKOWN";
                self.emit('deviceFound', device, deviceType);
              }
            } catch (err) {
              console.log("ERROR" + err);
            }
          });
        }
      });
    });
  }
}

module.exports = upnpClient;
