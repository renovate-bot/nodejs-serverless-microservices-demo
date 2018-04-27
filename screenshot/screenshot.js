'use strict';

// the following is a workaround:
// Cloud Storage library tries to write in /home/ when uploading a buffer
process.env.HOME = '/tmp';

const express = require('express');
const puppeteer = require('puppeteer');
const Storage = require('@google-cloud/storage');

const logger = require('./logger');

const storage = new Storage();

const app = express();

app.use(async (req, res, next) => {
  if(req.path === '/') {
    const err = new Error('Please provide URL, example: /http://example.com')
    logger.error(err);
    next(err);
    return;
  }

  // make sure the URL starts with a protocol
  if(!req.path.startsWith('/http')) {return res.status(400).send('URL must start with http:// or https://');}

  const url = req.path.slice(1);
  logger.info(`URL: ${url} - starting screenshot`);
  
  let browser;
  let page;

  try {
    browser = await puppeteer.launch({
      headless: true,
      timeout: 90000,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    page = await browser.newPage();
    await page.goto(url);
  }
  catch (err) {
    next(err);
    return;
  }

  // Custom CSS to avoid capturing blinking cursors when input fields have focus
  const hideInputTextCSS = `
    input {
      color: transparent;
      text-shadow: 0 0 0 black;
    }
    input:focus {
      outline: none;
    }
  `;
  
  let imageBuffer;

  try {
    await page.addStyleTag({ content: hideInputTextCSS });
    imageBuffer = await page.screenshot();
    await browser.close();
  }
  catch (err) {
    next(err)
    return;
  }

  logger.info(`URL: ${url} - screenshot taken`);
  
  // Uploads a local file to the bucket

  logger.info(`URL: ${url} - saving screenshot to GCS bucket: ${process.env.SCREENSHOT_BUCKET_NAME}`);

  const bucketName = process.env.SCREENSHOT_BUCKET_NAME;
  const date = new Date();
  const timestamp = date.getTime();
  const filename = `${timestamp}.png`;
  const filepath = url.replace(/[^a-z0-9]/gi, '_').toLowerCase();

  try {
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(`screenshots/${filepath}/${filename}`);
    await file.save(imageBuffer);
  }
  catch (err) {
    next(err);
    return;
  }

  logger.info(`URL: ${url} - screenshot saved`);

  // returns the screenshot
  res.set('Content-Type', 'image/png')
  res.send(imageBuffer);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // log the error
  logger.error(err);
  // render the error page
  res.status(err.status || 500);
  res.end(err.message);
});

const server = app.listen(process.env.PORT || 8080, err => {
  if (err) return console.error(err);
  const port = server.address().port;
  console.log(`App listening on port ${port}`);
});