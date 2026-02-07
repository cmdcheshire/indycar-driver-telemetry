class BadDataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadDataError';
  }
}

module.exports = { BadDataError };
