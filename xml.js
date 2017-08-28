var parseString = require('xml2js').parseString;

parseString('<apps><app id="0" name="netflix">Netflix</app><app id="1" name="hulu">Hulu</app></apps>', (error, result) => {
    if (error) {
        console.error(error);
    } else {
        console.log(JSON.stringify(result));
    }
})