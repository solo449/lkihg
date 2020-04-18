'use strict';

const { Posts, Bans } = require(__dirname+'/../../db/')
	, getTripCode = require(__dirname+'/../../helpers/posting/tripcode.js')
	, messageHandler = require(__dirname+'/../../helpers/posting/message.js')
	, nameHandler = require(__dirname+'/../../helpers/posting/name.js')
	, { previewReplies, strictFiltering } = require(__dirname+'/../../configs/main.js')
	, buildQueue = require(__dirname+'/../../queue.js')
	, dynamicResponse = require(__dirname+'/../../helpers/dynamic.js')
	, { buildThread } = require(__dirname+'/../../helpers/tasks.js')
	, { remove } = require('fs-extra');

module.exports = async (req, res, next) => {

/*
todo: handle some more situations
- last activity date
- correct bump date when editing thread or last post in a thread
- allow for regular users (OP ONLY) and option for staff to disable in board settings
*/

	const { board, post } = res.locals;

	//filters
	if (res.locals.permLevel > 1) { //global staff bypass filters for edit
		const globalSettings = await cache.get('globalsettings');
		if (globalSettings && globalSettings.filters.length > 0 && globalSettings.filterMode > 0) {
			let hitGlobalFilter = false
				, ban
				, concatContents = `|${req.body.name}|${req.body.message}|${req.body.subject}|${req.body.email}|${res.locals.numFiles > 0 ? req.files.file.map(f => f.name).join('|') : ''}`.toLowerCase()
				, allContents = concatContents;
			if (strictFiltering) {
				allContents += concatContents.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); //removing diacritics
				allContents += concatContents.replace(/[\u200B-\u200D\uFEFF]/g, ''); //removing ZWS
				allContents += concatContents.replace(/[^a-zA-Z0-9.-]+/gm, ''); //removing anything thats not alphamnumeric or . and -
			}
			//global filters
			hitGlobalFilter = globalSettings.filters.some(filter => { return allContents.includes(filter.toLowerCase()) });
			if (hitGlobalFilter) {
				if (globalSettings.filterMode === 1) {
					return dynamicResponse(req, res, 400, 'message', {
						'title': 'Bad request',
						'message': 'Your edit was blocked by a global word filter',
					});
				} else {
					const banDate = new Date();
					const banExpiry = new Date(globalSettings.filterBanDuration + banDate.getTime());
					const ban = {
						'ip': res.locals.ip.single,
						'reason': 'global word filter auto ban',
						'board': null,
						'posts': null,
						'issuer': 'system', //what should i call this
						'date': banDate,
						'expireAt': banExpiry,
						'allowAppeal': true, //should i make this configurable if appealable?
						'seen': false
					};
 					await Bans.insertOne(ban);
					const bans = await Bans.find(res.locals.ip.single, banBoard); //need to query db so it has _id field for appeal checkmark
					return res.status(403).render('ban', {
						bans: bans
					});
				}
			}
		}
	}

	//new name, trip and cap
	const { name, tripcode, capcode } = await nameHandler(req.body.name, res.locals.permLevel, board.settings);
	//new message and quotes
	const { message, quotes, crossquotes } = await messageHandler(req.body.message, req.body.board, post.thread);
	//todo: email and subject (probably dont need any transformation since staff bypass limits on forceanon, and it doesnt have to account for sage/etc

	//intersection/difference of quotes sets for linking and unlinking
	const oldQuoteIds = post.quotes.map(q => q._id);
	const oldQuotesSet = new Set(oldQuoteIds);
	const newQuoteIds = quotes.map(q => q._id);
	const addedQuotesSet = new Set(newQuoteIds.filter(qid => !oldQuotesSet.has(qid)));
	//linking new added quotes
	if (addedQuotesSet.size > 0) {
		await Posts.db.updateMany({
			'_id': {
				'$in': [...addedQuotesSet]
			}
		}, {
			'$push': {
				'backlinks': { _id: post._id, postId: post.postId }
			}
		});
	}

	const removedQuotesSet = new Set(oldQuoteIds.filter(qid => !addedQuotesSet.has(qid)));
	//unlinking removed quotes
	if (removedQuotesSet.size > 0) {
		await Posts.db.updateMany({
			'_id': {
				'$in': [...removedQuotesSet]
			}
		}, {
			'$pull': {
				'backlinks': {
					'postId': post.postId
				}
			}
		});
	}


	//update the post
	const postId = await Posts.db.updateOne({
		board: req.body.board,
		postId: post.postId
	}, {
		'$set': {
			edited: {
				username: req.session.user.username,
				date: new Date(),
			},
			message,
			quotes,
			crossquotes,
			name,
			tripcode,
			capcode,
			email: req.body.email,
			subject: req.body.subject,
		}
	});

	const buildOptions = {
		'threadId': post.thread || post.postId,
		'board': res.locals.board
	};

	//build thread immediately for redirect
	await buildThread(buildOptions);

	dynamicResponse(req, res, 200, 'message', {
		'title': 'Success',
		'message': 'Post edited successfully',
		//redirect
	});
	res.end();

	let postInPreviewPosts = false;
	if (post.thread) {
		const threadPreviewPosts = await Posts.db.find({
			'thread': post.thread,
			'board': board._id
		},{
			'projection': {
				'postId': 1, //only get postId
			}
		}).sort({
			'postId': -1
		}).limit(previewReplies).toArray();
		postInPreviewPosts = threadPreviewPosts.some(p => p.postId <= post.postId)
	}

	if (post.thread === null || postInPreviewPosts) {
		const thread = post.thread === null ? post : (await Posts.getPost(board._id, post.thread));
		const threadPage = await Posts.getThreadPage(board._id, thread);
		//rebuild index page if its a thread or visible in preview posts
		buildQueue.push({
			'task': 'buildBoard',
			'options': {
				'board': res.locals.board,
				'page': threadPage
			}
		});
	}

	if (post.thread === null) {
		//rebuild catalog if its a thread to correct catalog tile
		buildQueue.push({
			'task': 'buildCatalog',
			'options': {
				'board': res.locals.board,
			}
		});
	}

}
