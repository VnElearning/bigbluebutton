
import { Tracker } from 'meteor/tracker';

import Storage from '/imports/ui/services/storage/session';

import Users2x from '/imports/api/users';
import { makeCall, logClient } from '/imports/ui/services/api';

const CONNECTION_TIMEOUT = Meteor.settings.public.app.connectionTimeout;

class Auth {
  constructor() {
    this._meetingID = Storage.getItem('meetingID');
    this._userID = Storage.getItem('userID');
    this._authToken = Storage.getItem('authToken');
    this._sessionToken = Storage.getItem('sessionToken');
    this._logoutURL = Storage.getItem('logoutURL');
    this._loggedIn = {
      value: false,
      tracker: new Tracker.Dependency(),
    };
  }

  get meetingID() {
    return this._meetingID;
  }

  set meetingID(meetingID) {
    this._meetingID = meetingID;
    Storage.setItem('meetingID', this._meetingID);
  }

  set sessionToken(sessionToken) {
    this._sessionToken = sessionToken;
    Storage.setItem('sessionToken', this._sessionToken);
  }

  get sessionToken() {
    return this._sessionToken;
  }

  get userID() {
    return this._userID;
  }

  set userID(userID) {
    this._userID = userID;
    Storage.setItem('userID', this._userID);
  }

  get token() {
    return this._authToken;
  }

  set token(authToken) {
    this._authToken = authToken;
    Storage.setItem('authToken', this._authToken);
  }

  set logoutURL(logoutURL) {
    this._logoutURL = logoutURL;
    Storage.setItem('logoutURL', this._logoutURL);
  }

  get logoutURL() {
    return this._logoutURL;
  }

  get loggedIn() {
    this._loggedIn.tracker.depend();
    return this._loggedIn.value;
  }

  set loggedIn(value) {
    this._loggedIn.value = value;
    this._loggedIn.tracker.changed();
  }

  get credentials() {
    return {
      meetingId: this.meetingID,
      requesterUserId: this.userID,
      requesterToken: this.token,
      logoutURL: this.logoutURL,
      sessionToken: this.sessionToken,
    };
  }

  set(meetingId, requesterUserId, requesterToken, logoutURL, sessionToken) {
    this.meetingID = meetingId;
    this.userID = requesterUserId;
    this.token = requesterToken;
    this.logoutURL = logoutURL;
    this.sessionToken = sessionToken;
  }

  clearCredentials(...args) {
    this.meetingID = null;
    this.userID = null;
    this.token = null;
    this.loggedIn = false;
    this.logoutURL = null;
    this.sessionToken = null;

    return Promise.resolve(...args);
  }

  logout() {
    if (!this.loggedIn) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const credentialsSnapshot = {
        meetingId: this.meetingID,
        requesterUserId: this.userID,
        requesterToken: this.token,
      };

      // make sure users who did not connect are not added to the meeting
      // do **not** use the custom call - it relies on expired data
      Meteor.call('userLogout', credentialsSnapshot, (error) => {
        if (error) {
          logClient('error', { error, method: 'userLogout', credentialsSnapshot });
        } else {
          this.fetchLogoutUrl()
            .then(this.clearCredentials)
            .then(resolve);
        }
      });
    });
  }

  authenticate(force) {
    if (this.loggedIn && !force) return Promise.resolve();

    return this._subscribeToCurrentUser()
      .then(this._addObserverToValidatedField.bind(this));
  }

  _subscribeToCurrentUser() {
    const credentials = this.credentials;

    return new Promise((resolve, reject) => {
      Tracker.autorun((c) => {
        if (!(credentials.meetingId && credentials.requesterToken && credentials.requesterUserId)) {
          reject({
            error: 500,
            description: 'Authentication subscription failed due to missing credentials.',
          });
        }

        setTimeout(() => {
          c.stop();
          reject({
            error: 500,
            description: 'Authentication subscription timeout.',
          });
        }, 5000);

        const subscription = Meteor.subscribe('current-user2x', credentials);
        if (!subscription.ready()) return;

        resolve(c);
      });
    });
  }

  _addObserverToValidatedField(prevComp) {
    return new Promise((resolve, reject) => {
      const validationTimeout = setTimeout(() => {
        clearTimeout(validationTimeout);
        prevComp.stop();
        this.clearCredentials();
        reject({
          error: 500,
          description: 'Authentication timeout.',
        });
      }, CONNECTION_TIMEOUT);

      const didValidate = () => {
        this.loggedIn = true;
        clearTimeout(validationTimeout);
        prevComp.stop();
        resolve();
      };

      Tracker.autorun((c) => {
        const selector = { meetingId: this.meetingID, userId: this.userID };
        const query = Users2x.find(selector);

        query.observeChanges({
          changed: (id, fields) => {
            if (fields.validated === true) {
              c.stop();
              didValidate();
            }

            if (fields.validated === false) {
              c.stop();
              this.clearCredentials();
              reject({
                error: 401,
                description: 'Authentication failed.',
              });
            }
          },
        });
      });

      makeCall('validateAuthToken2x');
    });
  }

  fetchLogoutUrl() {
    return Promise.resolve(this._logoutURL);
  }
}

const AuthSingleton = new Auth();
export default AuthSingleton;
