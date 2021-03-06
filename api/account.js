const { URL } = require("url");

const API = require("./api");
const PlexDevice = require("./device");
const PlexClient = require("./client");

/**
 * Sorts potential connections in order of preferences. Prefers local
 * connections and discourages relays connections.
 * 
 * @typedef {Object} Connection a conection descriptor.
 * @property {boolean} relay if the connection is a relay connection.
 * @property {boolean} local if the connection is a local connection.
 * @param {Connection} a 
 * @param {Connection} b 
 * @returns positive to sort a lower, negative to sort a higher.
 */
function sortConnections(a, b) {
  if (a.relay != b.relay) {
    return a.relay ? 1 : -1;
  }

  if (a.local != b.local) {
    return a.local ? -1 : 1;
  }

  return 0;
}

/**
 * Attempts to connect to a device based on its list of connection options.
 * 
 * @param {PlexClient} client the client to use.
 * @param {Object} resourceData data about the device.
 * @param {String} backupToken the authentication token to use if no other is
 *                             specified.
 * @returns {Promise<PlexDevice>} the connected device or throws in connection failure.
 */
async function connectDevice(client, resourceData, backupToken) {
  let connections = resourceData.Connection.map(c => ({
    uri: new URL(c.uri),
    local: c.local == "1",
    relay: c.relay == "1",
  })).sort(sortConnections);

  let token = resourceData.accessToken || backupToken;
  for (let conn of connections) {
    try {
      let device = await PlexDevice.connect(client, conn.uri, token);

      // For some reason some players advertise their server's connection info.
      // Not sure what to do here other than refuse to connect in that case.
      if (device.id == resourceData.clientIdentifier) {
        return device;
      }
    } catch (e) {
      // Ignore failures to connect
    }
  }

  throw new Error(`Unable to connect to device "${resourceData.name}".`);
}

/**
 * Represents a user's plex.tv account information. Used for listing associated
 * devices, see getResource, getResources or getServer.
 */
class PlexAccount {
  /**
   * This is an internal class and should not be instantiated directly. Instead
   * use PlexAccount.login to create an instance.
   * 
   * @param {PlexClient} client the connection info to use for API calls.
   * @param {*} data the parsed data for the account.
   */
  constructor(client, data) {
    this._client = client;
    this._data = data;
  }

  /**
   * Logs in to a plex.tv account and returns a PlexAccount instance.
   * 
   * @param {PlexClient} client the client data to use to request login.
   * @param {String} username the user's username.
   * @param {String} password the user's password.
   * @returns {Promise<PlexAccount>} the account instance on success.
   */
  static async login(client, username, password) {
    let url = new URL(API.PLEX_WEB_SIGNIN, client._options.plexWebURL);
    let data = await client.request(url, { method: "POST", form: { login: username, password }});
    return new PlexAccount(client, data);
  }

  /**
   * The username associated with the account.
   * 
   * @returns {String} the username.
   */
  get username() {
    return this._data.username;
  }

  /**
   * The name associated with the account.
   * 
   * @returns {String} the name.
   */
  get name() {
    return this._data.title;
  }

  /**
   * The email address associated with the account.
   * 
   * @returns {String} the email.
   */
  get email() {
    return this._data.email;
  }

  /**
   * Retrieves a PlexDevice for a recently used resource. This generally means
   * API clients that can be controlled or accessed in some way.
   * 
   * @param {String} name the name of the device
   * @returns {Promise<PlexDevice>} the device on success.
   */
  async getResource(name) {
    let url = new URL(API.PLEX_WEB_RESOURCES, this._client._options.plexWebURL);
    let data = await this._client.request(url, { token: this._data.authToken });
    for (let deviceData of data.MediaContainer.Device) {
      if (deviceData.name != name) {
        continue;
      }

      return await connectDevice(this._client, deviceData, this._data.authToken);
    }

    throw new Error(`No resource named ${name}`);
  }

  /**
   * Retrieves a list of PlexDevice's that support the passed features.
   * 
   * @param {String[]} provides a list of features the resource should support.
   * @returns {Promise<PlexDevice[]>} a list of devices.
   */
  async getResources(provides = []) {
    let connectPromises = [];
    let url = new URL(API.PLEX_WEB_RESOURCES, this._client._options.plexWebURL);
    let data = await this._client.request(url, { token: this._data.authToken });
    for (let deviceData of data.MediaContainer.Device) {
      if (!PlexDevice.checkProvides(deviceData.provides, provides)) {
        continue;
      }

      connectPromises.push(connectDevice(this._client, deviceData, this._data.authToken).catch(() => null));
    }

    let connections = await Promise.all(connectPromises);
    return connections.filter(d => d);
  }

  /**
   * A shortcut for getting the server resources.
   * 
   * @returns {Promise<PlexDevice[]>} a list of servers.
   */
  getServers() {
    return this.getResources(["server"]);
  }
}

module.exports = PlexAccount;
