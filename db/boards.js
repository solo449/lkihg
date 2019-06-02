'use strict';

const Mongo = require(__dirname+'/db.js')
	, db = Mongo.client.db('jschan');

module.exports = {

	db: db.collection('boards'),

	findOne: (name) => {
		return db.collection('boards').findOne({ '_id': name });
	},

	find: () => {
		return db.collection('boards').find({}).toArray();
	},

	insertOne: (data) => {
		return db.collection('boards').insertOne(data);
	},

	deleteOne: (board, options) => {

	},

	deleteMany: (board, options) => {

	},

	deleteAll: (board) => {
		return db.collection('boards').deleteMany({});
	},

	removeBanners: (board, filenames) => {
		return db.collection('boards').updateOne(
			{
				'_id': board,
			}, {
				'$pullAll': {
					'banners': filenames
				}
			}
		);
	},

	addBanners: (board, filenames) => {
		return db.collection('boards').updateOne(
			{
				'_id': board,
			}, {
				'$push': {
					'banners': {
						'$each': filenames
					}
				}
			}
		);
	},

	exists: async (req, res, next) => {

		const board = await module.exports.findOne(req.params.board);
		if (!board) {
			return res.status(404).render('404');
		}
		res.locals.board = board; // can acces this in views or next route handlers
		next();

	},

	canManage: (req, res, next) => {

		if (req.session.user.authLevel === 3
			|| res.locals.board.owner == req.session.user.username
			|| res.locals.board.moderators.includes(req.session.user.username)) {
			return next();
		}
		return res.status(403).render('message', {
			'title': 'Forbidden',
			'message': 'You do not have permission to manage this board',
			'redirect': '/login.html'
		});

	},

	getNextId: async (board) => {

		const increment = await db.collection('counters').findOneAndUpdate(
			{
				'_id': board
			},
			{
				'$inc': {
					'sequence_value': 1
				}
			},
			{
				'upsert': true
			}
		);

		return increment.value.sequence_value;

	},

	deleteIncrement: async (board) => {

		await db.collection('counters').findOneAndUpdate(
			{
				'_id': board
			},
			{
				'$set': {
					'sequence_value': 1
				}
			},
			{
				'upsert': true
			}
		);

		return;

	},

}
