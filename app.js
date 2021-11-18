require('dotenv').config()
const express = require('express')
const mongoose = require('mongoose')
const session = require('express-session')

const { Schema } = mongoose;
const app = express()

const urlRegex = new RegExp("(?<protocol>https?):\/\/(?<hostname>[A-Za-z.0-9]*)\/?:?(?<port>\d*)", "g")

const urlMatch = urlRegex.exec(process.env.SITE_URL)

const protocol = urlMatch.groups.protocol ? urlMatch.groups.protocol : "http" 
const hostname = urlMatch.groups.hostname ? urlMatch.groups.hostname : "localhost" 
const port = urlMatch.groups.port ? urlMatch.groups.port : 3000 


let sess = {
  secret: process.env.SECRET,
  cookie: {},
  resave: true,
  saveUninitialized: true
}

if (process.env.TRUST_PROXY > 0) {
  app.set('trust proxy', process.env.TRUST_PROXY)
}

if (protocol.includes("https")) {
  sess.cookie.secure = true
  console.log("Using secure cookies...")
}

app.use(session(sess))

app.use(express.urlencoded({ extended: true }))
app.use(express.json());

mongoose.connect(process.env.MONGO_URI);

const makeid = (length) => {
  let result = '';
  let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let charactersLength = characters.length;
  for ( var i = 0; i < length; i++ ) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }

  return result;
}

const PasteSchema = new Schema({
  title: String,
  id: { type: String, default: makeid(12) },
  author: String,
  ip: String,
  content: String,
  date: { type: Date, default: Date.now },
  hidden: Boolean,
  meta: {
    votes: Number,
    favs:  Number,
    views: Number,
    size:  Number,
  }
});

PasteSchema.index({
  title: 'text',
  content: 'text', 
  id: 'text'
});

const Paste = mongoose.model('Paste', PasteSchema);

app.locals = {
  site: {
      title: process.env.TITLE,
      description: process.env.DESCRIPTION,
      protocol,
      hostname,
      port,
  },
  defaultPaste: {
    content: `Lorem ipsum dolor sit amet, consectetur adipisicing elit. Dicta tempore ad amet accusamus mollitia quis culpa provident odio facere, dolor quibusdam deleniti fuga minus vero molestias asperiores sequi! Officia atque, hic aspernatur culpa necessitatibus cumque doloremque rem. Fugiat vitae consectetur dolore eos voluptatibus vel, laborum saepe repellendus, dignissimos quaerat aut minus suscipit omnis possimus ipsam cumque sint repellat doloribus quasi neque quos laboriosam temporibus ullam? Ipsa maiores sequi quod perspiciatis vero cumque voluptatum quibusdam, ex impedit necessitatibus! Aliquid nulla ipsam, cupiditate aspernatur id eius fugit quasi maxime esse nam cum. Sunt tempore exercitationem praesentium, recusandae omnis asperiores sequi mollitia amet!

Lorem ipsum dolor sit amet, consectetur adipisicing elit. Dicta tempore ad amet accusamus mollitia quis culpa provident odio facere, dolor quibusdam deleniti fuga minus vero molestias asperiores sequi! Officia atque, hic aspernatur culpa necessitatibus cumque doloremque rem. Fugiat vitae consectetur dolore eos voluptatibus vel, laborum saepe repellendus, dignissimos quaerat aut minus suscipit omnis possimus ipsam cumque sint repellat doloribus quasi neque quos laboriosam temporibus ullam? Ipsa maiores sequi quod perspiciatis vero cumque voluptatum quibusdam, ex impedit necessitatibus! Aliquid nulla ipsam, cupiditate aspernatur id eius fugit quasi maxime esse nam cum. Sunt tempore exercitationem praesentium, recusandae omnis asperiores sequi mollitia amet!`
  }
}

app.set('view engine', 'ejs')

app.get('/', (req, res) => {
    res.render('pages/index')
})

app.get('/new', (req, res) => {
  res.render('pages/index')
})

app.post('/new', (req, res) => {
  if (req.body.paste === "") {
    res.redirect('/')
    return
  }
  const paste = {
    title: req.body.title,
    author: null,
    ip: process.env.TRUST_PROXY > 0 ? req.headers['x-forwarded-for'] : req.socket.remoteAddress.replace(/^.*:/, ''),
    content: req.body.paste,
    hidden: req.body.hidden === "on" ? true : false,
    meta: {
      votes: null,
      favs:  null,
      views: 0,
      size: Buffer.byteLength(req.body.paste, 'utf8'),  
    },
  }
  Paste.create(paste, (err, paste) => {
    if (err) throw err;
    res.redirect('/p/' + paste.id)
  })
})


app.get('/latest', (req, res) => {
  Paste.find({ hidden: false })
    .sort({date:-1})
    .limit(20)
    .exec((err, pastes) => {
      if (err) throw err
      res.render('pages/list', {
        pastes,
        title: "Viimeisimmät"
      })
    })
})

app.get('/popular', (req, res) => {
  Paste.find({ hidden: false })
    .sort('-meta.views')
    .limit(20)
    .exec((err, pastes) => {
      if (err) throw err
      res.render('pages/list', {
        pastes,
        title: "Suosituimmat"
      })
    })
})

app.get('/search', (req, res) => {
  // Use later full text indexes...

  let query = req.query.q
  let page = req.query.page
  let skip = page ? page : 0 * 10
  let limit = skip + 10
  Paste.find({ title: { "$regex": query, "$options": "i" }, hidden: false })
    .sort('date')
    .skip(skip)
    .limit(limit)
    .exec((err, pastes) => {
      if (err) throw err
      res.render('pages/list', {
        pastes,
        title: ""
      })
  })
})

app.get('/p/:id', (req, res) => {
  Paste.findOne({ id: req.params.id }).exec(async (err, paste) => {
    if (err) throw err
    await Paste.findOneAndUpdate({ id: req.params.id }, {$inc : {'meta.views' : 1}})
    if (!paste.meta.size) {
      paste.meta.size = Buffer.byteLength(paste.content, 'utf8')
      await Paste.findOneAndUpdate({ id: req.params.id }, {$inc : {'meta.size' : paste.meta.size}})
    }

    res.render('pages/paste', {
      paste
    })
  })
})

app.get('/r/:id', (req, res) => {
  Paste.findOne({ id: req.params.id }).exec(async (err, paste) => {
    if (err) throw err
    await Paste.findOneAndUpdate({ id: req.params.id }, {$inc : {'meta.views' : 1}})
    res.set('Content-Type', 'text/plain');
    res.send(paste.content)
  })
})

app.get('/dl/:id', (req, res) => {
  Paste.findOne({ id: req.params.id }).exec(async (err, paste) => {
    if (err) throw err
    await Paste.findOneAndUpdate({ id: req.params.id }, {$inc : {'meta.views' : 1}})
    res.status(200)
      .attachment(`${paste.title}.txt`)
      .send(paste.content)
  })
})

// Sitemap and other
app.get('/sitemap.xml', (req, res) => {
  Paste.find().exec((err, pastes) => {
    if (err) throw err
    res.set('Content-Type', 'text/xml');
    res.render('sitemap', {
      pastes
    })
  })
})

app.listen(port, () => {
  console.log(`PowerPaste app listening at ${protocol}://${hostname}:${port}`)
})