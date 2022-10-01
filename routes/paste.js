const mongoose = require('mongoose');
const sha256 = require('js-sha256').sha256;
const fs = require('fs/promises');

const { makeid, checkReputation } = require('../helpers');
const schemas = require('../schemas');

mongoose.connect(process.env.MONGO_URI);

const Paste = mongoose.model('Paste', schemas.PasteSchema);
exports.Paste = Paste;

const abuseipdbKey = process.env.ABUSEIPDB_KEY
const dataDir = process.env.DATA_DIR

exports.new = async (req, res) => {
    if (req.body.paste === "") {
        res.redirect('/');
        return;
    }

    const ip = process.env.TRUST_PROXY > 0 ? req.headers['x-forwarded-for'] : req.socket.remoteAddress.replace(/^.*:/, '');
    const reputation = JSON.parse(await checkReputation(ip, abuseipdbKey))

    if ("errors" in reputation) {
        reputation.errors.forEach(error => {
            console.log('AbuseIPDB', error)
        });
    } else {
        if (reputation.data.abuseConfidenceScore > 60) {
            res.status(403).send({
                "error": "IP-osoitteesi on mustalla listalla emmekä hyväksy uusia liitteitä sieltä."
            });
            return;
        }
    }

    const content = req.body.paste
    const title = req.body.title
    const size = Buffer.byteLength(content, 'utf8')
    const language = req.body.language ? req.body.language : 'html'

    if (size > 10_000_000)
        return res.status(413).send({
            status : "fail",
            data : { 
                "title" : "Liian iso",
                "message": "Palveluun ei voi luoda ilman tiliä yli 10 MB liitteitä."
            }
        })

    if (title.length > 300)
        return res.status(413).send({
            status : "fail",
            data : { 
                "title" : "Virheellinen nimi",
                "message": "Palveluun ei voi luoda liitettä yli 300 merkin otsikolla."
            }
        })

    if (language.length > 10)
        return res.status(413).send({
            status : "fail",
            data : { 
                "title" : "Virheellinen ohjelmointikieli",
                "message": "Ohjelmointikielen nimi ei voi olla yli kymmentä merkkiä."
            }
        })

    const hash = sha256(content)
    if (await Paste.exists({ sha256: hash })) {
        console.log("Liite samalla sisällöllä on jo olemassa")
        const id = (await Paste.findOne({ sha256: hash }).select('id -_id')).id
        res.send({
            "id": id
        });
        return;
    }

    const deleteKey = makeid(64);

    const paste = {
        title: title,
        author: null,
        id: makeid(7),
        ip: ip,
        content: content,
        hidden: req.body.private == true ? true : false,
        programmingLanguage: language,
        sha256: hash,
        deletekey: deleteKey,
        meta: {
            votes: null,
            favs: null,
            views: 0,
            size: size,
        },
    };

    // await fs.writeFile(`${dataDir}/${hash}`, content);

    Paste.create(paste, (err, paste) => {
        if (err) throw err;
        console.log(`${Date.now().toString()} - New paste created with id ${paste.id}`);
        res.send({
            "id": paste.id,
            "delete": deleteKey
        });
    });
};

exports.get = (req, res) => {
    // Show other similar pastes under the paste
    const requestedId = req.params.id;

    Paste.findOne({ id: requestedId }).exec(async(err, paste) => {
        if (err) throw err

        if (paste == null)
            return res.status(404).send({
                status : "fail",
                data : { 
                    "title" : "Liitettä ei löydy",
                    "message": "Liitettä ei ole olemassa tai se on poistettu."
                }
            })

        await Paste.findOneAndUpdate({ id: requestedId }, { $inc: { 'meta.views': 1 } });
        
        if (!paste.meta.size) {
            paste.meta.size = Buffer.byteLength(paste.content, 'utf8');
            await Paste.findOneAndUpdate({ id: requestedId }, { $inc: { 'meta.size': paste.meta.size } });
        }

        if (paste.removed.isRemoved) {
            res.send(paste.removed);
        }

        // Filter out unwanted data (ip address, removal and so on...)
        allowedKeys = ['programmingLanguage', 'hidden', 'id', 'content', 'meta', 'allowedreads', 'date', 'author', 'title' ];
        let visiblePaste = JSON.parse(JSON.stringify(paste)) // https://stackoverflow.com/questions/9952649/convert-mongoose-docs-to-json
        Object.keys(visiblePaste).forEach((key) => allowedKeys.includes(key) || delete visiblePaste[key]);

        try {
            const content = await fs.readFile(`${dataDir}/${paste.sha256}`)
            visiblePaste.content = content.toString()
            console.log(`${(new Date).toLocaleString('fi-FI')} - Katsottu liite ${paste.id}`);
            res.send(visiblePaste);
        } catch (error) {
            visiblePaste.content = paste.content
            res.send(visiblePaste)
            // res
            //     .status(410)
            //     .send({
            //         "error": "Liitteen data on kadonnut levyltä."
            //     });
        }
    });
};

exports.filter = async(req, res) => {
    // TODO: Highlight the search result for client. || can be done on the client side

    let query = req.query.q || "";
    let offset = req.query.offset || 0;
    let limit = req.query.limit || 10;
    let sorting = req.query.sorting || "-meta.views";

    // Do not allow too many pastes
    limit = limit > 30 ? 30 : limit;

    allowedSortings = ['-date', 'date', '-meta.views', 'meta.views', '-meta.size', 'meta.size', '-meta.votes', 'meta.votes', '-meta.favs', '-meta.favs']
    if (!allowedSortings.includes(sorting))
        sorting = '-meta.views'

    let search = { hidden: false };
    let score = {};
    if (query) {
        score = { score: { $meta: "textScore" } }
        search.$text = { $search: query }
    }

    Paste.find(search, score)
        .sort(sorting)
        .skip(offset)
        .limit(limit)
        .select('id title meta author date -_id')
        .exec((err, pastes) => {
            if (err) console.error(err)
            res.send(pastes)
        })
};
