//create server

const express = require('express');
const port = process.env.PORT || 3000;
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');

const app = express();

// Middleware
app.use(morgan('combined'));
app.use(helmet());
app.use(cors());

//create server
app.get('/', (req, res) => {
    res.send('Hello World!');
});

//create endpoint
app.get('/search', async (req, res) => {
    let { query, timerange, region, max } = req.query;
    if (!query) {
        res.status(400).send('Missing query parameter.');
        return;
    }
    if (!timerange) {
        timerange = '1h';
    }
    if (!region) {
        region = 'us';
    }
    if (!max || max == 0) {
        max = 3;
    }
    await api.webSearch({query,timerange,region}, max-1).then((results) => {
        res.send(results);
    }
    );

});

app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
});