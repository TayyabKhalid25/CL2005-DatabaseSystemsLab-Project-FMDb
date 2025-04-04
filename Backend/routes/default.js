const express = require('express');
const router = express.Router();

// Default route
router.get('', (req, res) => {
    res.send('Hello World!'); // Example default route
});

module.exports = router;
