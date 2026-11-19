import { randomUUID } from 'node:crypto';
import type { Driver, Transaction } from 'neo4j-driver';
import { AuthRepository } from '../modules/auth/auth.repository.js';
import { normalizeEmail, validatePassword } from '../modules/auth/identity.js';
import { PasswordService } from '../modules/auth/password.service.js';
import { UsersRepository } from '../modules/users/users.repository.js';
import { UsersService } from '../modules/users/users.service.js';
import { FriendshipsRepository } from '../modules/friendships/friendships.repository.js';
import { FriendshipsService } from '../modules/friendships/friendships.service.js';
import { PostsRepository } from '../modules/posts/posts.repository.js';
import { PostsService } from '../modules/posts/posts.service.js';
import { TransactionNeo4jService } from './transaction-neo4j.service.js';
import type { DemoManifest } from './manifest.js';

const bios = [
  'Thích những chuyến đi chậm và ghi lại câu chuyện của mỗi vùng đất.',
  'Mê cà phê, sách cũ và những cuộc trò chuyện tử tế.',
  'Mình làm vườn trên ban công, cuối tuần thường đi bộ quanh thành phố.',
  'Người yêu âm nhạc acoustic và những quán ăn nhỏ.',
  'Đang học chụp ảnh đường phố, luôn sẵn lòng chia sẻ góc nhìn.',
  'Thích nấu món Việt và mời bạn bè cùng thử công thức mới.',
  'Kỹ sư phần mềm, thích chạy bộ và khám phá công nghệ hữu ích.',
  'Tìm cảm hứng từ kiến trúc, bảo tàng và những con phố xưa.',
  'Yêu biển, thích bơi sớm và giữ nhịp sống cân bằng.',
  'Đọc sách lịch sử, thích nghe mọi người kể chuyện đời mình.',
  'Hay đi trekking nhẹ và lưu lại các cung đường xanh.',
  'Thích thiết kế tối giản, cây xanh và những buổi sáng yên tĩnh.',
];
const locations = ['Hà Nội', 'Đà Nẵng', 'TP. Hồ Chí Minh', 'Huế', 'Cần Thơ', 'Đà Lạt'];
const posts: Array<{
  visibility: 'members' | 'friends';
  content: string;
  comments: string[];
}> = [
  { visibility: 'members', content: 'Sáng nay mình đi bộ quanh hồ lúc thành phố còn yên ắng. Mùi hoa sữa thoảng qua làm mình nhớ những mùa thu cũ.', comments: ['Hồ Gươm sáng sớm cũng yên như vậy, nhất là đoạn gần cầu Thê Húc.', 'Mùi hoa sữa đầu mùa là dấu hiệu Hà Nội sắp vào thu rồi.'] },
  { visibility: 'friends', content: 'Cuối tuần thử pha cà phê phin chậm hơn một chút. Hóa ra chờ đợi cũng là một phần thú vị của tách cà phê.', comments: ['Mình hay tráng phin bằng nước nóng trước, cà phê nhỏ giọt đều hơn.', 'Uống phin buổi sáng thong thả đúng là dễ bắt đầu ngày mới hơn.'] },
  { visibility: 'members', content: 'Có ai gợi ý một cuốn sách nhẹ nhàng để đọc trên chuyến tàu sắp tới không?', comments: ['“Cho tôi xin một vé đi tuổi thơ” đọc trên tàu rất hợp đó.', 'Mình thường tải sẵn sách nói để nghe lúc tàu qua những đoạn ồn.'] },
  { visibility: 'friends', content: 'Chia sẻ vài tấm ảnh từ con đường ven biển hôm qua — gió mát và trời trong đến bất ngờ.', comments: ['Đoạn đường ven biển Sơn Trà hôm trời quang lên ảnh đẹp lắm.', 'Gió biển trong ảnh nhìn thôi cũng thấy mát rồi.'] },
  { visibility: 'members', content: 'Mình vừa trồng thêm húng quế ở ban công. Nếu có mẹo chăm cây mùa mưa thì chỉ mình nhé!', comments: ['Mưa nhiều thì kê chậu cao lên để đáy chậu không bị ngâm nước.', 'Húng quế thích nắng sáng, mình tỉa ngọn thường xuyên là cây ra lá mới.'] },
  { visibility: 'friends', content: 'Một bữa cơm nhà đơn giản đôi khi là cách tốt nhất để khép lại một ngày dài.', comments: ['Đĩa rau luộc với bát canh nóng nhiều khi ngon hơn đi ăn ngoài.', 'Nhà mình cũng giữ bữa cơm tối làm lúc cả nhà kể chuyện trong ngày.'] },
  { visibility: 'members', content: 'Tuần này mình thử đi làm bằng xe buýt, có thêm thời gian nghe podcast và ngắm phố.', comments: ['Ngồi xe buýt ngắm phố lúc tan tầm có góc nhìn rất khác.', 'Podcast giúp quãng đường đi làm ngắn lại hẳn.'] },
  { visibility: 'friends', content: 'Góc nhỏ mới tìm được có nhạc acoustic rất dễ chịu. Hẹn bạn bè cuối tuần quay lại.', comments: ['Quán có sân vườn gần phố cổ cũng hay chơi acoustic tối thứ bảy.', 'Nhạc vừa đủ nghe để vẫn trò chuyện được là thích nhất.'] },
  { visibility: 'members', content: 'Điều gì khiến bạn thấy một ngày bình thường trở nên đáng nhớ? Với mình là một lời hỏi thăm đúng lúc.', comments: ['Một cuộc gọi hỏi thăm bất ngờ có thể làm cả ngày nhẹ nhàng hơn.', 'Mình nhớ nhất những lần bạn bè nhắn đúng lúc mình đang cần.'] },
  { visibility: 'friends', content: 'Buổi chạy sáng nay không nhanh hơn hôm trước, nhưng mình đã không bỏ cuộc giữa đường.', comments: ['Giữ được nhịp chạy đều quan trọng hơn cố tăng tốc mỗi buổi.', 'Chạy xong nhớ thả lỏng chân một chút nhé, mai sẽ đỡ mỏi.'] },
  { visibility: 'members', content: 'Mình đang tìm công thức món chay dễ làm cho bữa tối. Món đậu hũ sốt cà là lựa chọn quen thuộc của bạn nào?', comments: ['Thêm chút nấm vào sốt cà ăn với đậu hũ rất vừa vị.', 'Mình áp chảo đậu trước nên miếng đậu không bị nát khi rim.'] },
  { visibility: 'friends', content: 'Một chuyến đi ngắn đến Huế, mình ấn tượng nhất với nhịp sống bình thản và những hàng cây xanh.', comments: ['Đi dọc sông Hương lúc chiều muộn thấy Huế chậm rãi thật.', 'Mấy con đường rợp bóng cây ở Huế đi bộ rất dễ chịu.'] },
  { visibility: 'members', content: 'Có những bức ảnh không cần hoàn hảo, chỉ cần giữ được cảm giác của khoảnh khắc ấy.', comments: ['Ảnh chụp vội đôi khi lại giữ được cảm xúc thật nhất.', 'Ánh sáng và khoảnh khắc thường quan trọng hơn bố cục hoàn hảo.'] },
  { visibility: 'friends', content: 'Hôm nay học được cách làm bánh mì từ cô hàng xóm. Bí quyết là kiên nhẫn với từng mẻ bột.', comments: ['Ủ bột đủ thời gian thì ruột bánh sẽ xốp hơn nhiều.', 'Mẻ đầu tiên của mình cũng chưa nở đẹp, làm vài lần sẽ quen tay.'] },
  { visibility: 'members', content: 'Mình muốn bắt đầu đọc sách mỗi tối thay vì lướt điện thoại. Ai có thói quen nhỏ nào giúp duy trì không?', comments: ['Để sách sẵn trên gối giúp mình nhớ đọc vài trang trước khi ngủ.', 'Mình đặt điện thoại ngoài phòng ngủ để khỏi tiện tay mở lên.'] },
  { visibility: 'friends', content: 'Chợ sáng cuối tuần đầy màu sắc và tiếng cười. Mình mua được bó hoa cúc nhỏ rất xinh.', comments: ['Hoa cúc cắm bình thấp nhìn tươi lâu lắm.', 'Đi chợ sớm chọn được hoa đẹp mà phố cũng chưa đông.'] },
  { visibility: 'members', content: 'Một bản nhạc cũ tình cờ vang lên và đưa mình về những năm tháng sinh viên.', comments: ['Nghe lại nhạc thời đại học là nhớ ngay những buổi làm bài nhóm.', 'Có bài hát chỉ cần vài nốt đầu là kéo cả ký ức quay về.'] },
  { visibility: 'friends', content: 'Cung đường trekking nhẹ nhàng, nhiều bóng cây; nhớ mang đủ nước và đi cùng bạn nhé.', comments: ['Đi đường rừng nên mang giày bám tốt, đoạn đất ẩm dễ trượt.', 'Mang thêm bình nước nhỏ và nghỉ dưới bóng cây giữa chặng nhé.'] },
  { visibility: 'members', content: 'Cuối tháng, mình dành một buổi để dọn lại góc làm việc. Không gian thoáng hơn, đầu óc cũng nhẹ hơn.', comments: ['Mình gom dây sạc bằng kẹp nhỏ, bàn làm việc gọn hẳn.', 'Bỏ bớt giấy tờ cũ giúp góc làm việc sáng sủa hơn nhiều.'] },
  { visibility: 'friends', content: 'Cảm ơn mọi người đã góp ý cho dự án nhỏ của mình. Mình sẽ chia sẻ bản cập nhật khi hoàn thiện.', comments: ['Phần góp ý về màn hình đầu tiên giúp dự án dễ dùng hơn đó.', 'Mong xem bản cập nhật, tiến độ của bạn đang rất ổn.'] },
  { visibility: 'members', content: 'Hôm nay mình học được rằng nghỉ ngơi cũng là một phần của năng suất.', comments: ['Đi bộ vài phút giữa giờ giúp mình tập trung lại tốt hơn.', 'Ngủ đủ giấc thường hiệu quả hơn cố làm thêm lúc đã kiệt sức.'] },
  { visibility: 'friends', content: 'Bữa sáng ở Đà Nẵng ngon hơn khi được ăn cùng những người bạn lâu ngày mới gặp.', comments: ['Mì Quảng ăn cùng bạn cũ đúng là vui hơn hẳn.'] },
  { visibility: 'members', content: 'Có ai thích đi bảo tàng vào ngày mưa không? Không gian yên tĩnh khiến mình tập trung hơn.', comments: ['Ngày mưa ở bảo tàng thường vắng, xem triển lãm thong thả hơn.'] },
  { visibility: 'friends', content: 'Trồng cây không khó bằng nhớ tưới cây. Mình đang đặt lịch nhắc để không quên nữa!', comments: ['Tưới cây vào buổi sáng giúp đất giữ ẩm lâu hơn.'] },
  { visibility: 'members', content: 'Một lời khen chân thành có thể làm người khác vui cả ngày. Hôm nay bạn đã khen ai chưa?', comments: ['Khen đúng điều người khác đã cố gắng luôn khiến họ vui.'] },
  { visibility: 'friends', content: 'Chụp ảnh hoàng hôn trên cầu, màu trời đổi liên tục chỉ trong vài phút.', comments: ['Chụp liên tục vài tấm lúc mặt trời lặn sẽ bắt được màu đẹp nhất.'] },
  { visibility: 'members', content: 'Mình đang tập nấu món mới mỗi tuần. Tuần này là canh chua miền Tây, nhà mình ai cũng xin thêm.', comments: ['Thêm giá và rau om lúc gần tắt bếp giữ được mùi thơm.'] },
];

export async function applyFixture(input: {
  driver: Driver; database: string; transaction: Transaction; manifest: DemoManifest;
  passwordHashes: string[];
}): Promise<{ users: number; friendships: number; pending: number; posts: number; comments: number; likes: number }> {
  const neo4j = new TransactionNeo4jService(input.driver, input.database, input.transaction);
  const auth = new AuthRepository(neo4j);
  const users = new UsersService(new UsersRepository(neo4j));
  const friendships = new FriendshipsService(new FriendshipsRepository(neo4j));
  const postsService = new PostsService(new PostsRepository(neo4j));
  const now = new Date().toISOString();

  const hashes = input.manifest.users.map((user, index) => {
    const email = normalizeEmail(user.email);
    validatePassword(user.password);
    return { user, email, passwordHash: input.passwordHashes[index]! };
  });
  for (const [index, entry] of hashes.entries()) {
    await auth.register({ id: entry.user.id, email: entry.email, passwordHash: entry.passwordHash, eventId: randomUUID(), now });
    await users.updateOwnProfile(entry.user.id, {
      displayName: entry.user.displayName, bio: bios[index], location: locations[index % locations.length], expectedVersion: 0,
    });
  }

  const accepted: Array<[number, number]> = [[0,1],[0,2],[0,3],[1,2],[1,4],[1,5],[2,3],[2,5],[2,6],[3,4],[3,7],[4,5],[4,8],[5,6],[5,9],[6,7],[8,10],[10,11]];
  for (const [index, [a, b]] of accepted.entries()) {
    const sender = input.manifest.users[a]!, recipient = input.manifest.users[b]!;
    const requestId = randomUUID();
    await friendships.createRequest(sender.id, recipient.id, requestId, new Date(Date.now() + index * 1000).toISOString());
    await friendships.actOnRequest(recipient.id, requestId, 'accept', randomUUID(), new Date(Date.now() + index * 1000 + 500).toISOString());
  }
  for (let i = 0; i < 5; i++) {
    const sender = input.manifest.users[(i * 2) % 12]!, recipient = input.manifest.users[(i * 2 + 5) % 12]!;
    await friendships.createRequest(sender.id, recipient.id, randomUUID(), now);
  }

  const createdPosts: Array<{ id: string; authorId: string; visibility: 'members' | 'friends' }> = [];
  const postWritesByActor = Array(input.manifest.users.length).fill(0) as number[];
  for (const [i, post] of posts.entries()) {
    const friendsAuthors = [0, 1, 2, 3, 4, 5];
    const authorIndex = post.visibility === 'friends' ? friendsAuthors[i % friendsAuthors.length]! : i % 12;
    const author = input.manifest.users[authorIndex]!;
    const created = await postsService.create(author.id, { content: post.content, visibility: post.visibility });
    postWritesByActor[authorIndex] = postWritesByActor[authorIndex]! + 1;
    createdPosts.push({ id: created.post.id, authorId: author.id, visibility: post.visibility });
  }
  let commentCount = 0;
  for (const [postIndex, post] of posts.entries()) {
    const authorIndex = input.manifest.users.findIndex((user) => user.id === createdPosts[postIndex]!.authorId);
    const actors = eligibleActorIndexes(post.visibility, authorIndex, accepted, input.manifest.users.length);
    const selected = new Set<number>();
    for (const [commentIndex, content] of post.comments.entries()) {
      const actorIndex = leastUsedEligibleActor(actors, postIndex + commentIndex, postWritesByActor, selected);
      const actor = input.manifest.users[actorIndex]!;
      await postsService.createComment(actor.id, createdPosts[postIndex]!.id, { clientId: randomUUID(), content });
      postWritesByActor[actorIndex] = postWritesByActor[actorIndex]! + 1;
      selected.add(actorIndex);
      commentCount++;
    }
  }
  let likes = 0;
  for (const [postIndex, post] of posts.entries()) {
    const authorIndex = input.manifest.users.findIndex((user) => user.id === createdPosts[postIndex]!.authorId);
    const actors = eligibleActorIndexes(post.visibility, authorIndex, accepted, input.manifest.users.length);
    const likeCount = postIndex < 21 ? 3 : 2;
    const selected = new Set<number>();
    for (let likeIndex = 0; likeIndex < likeCount; likeIndex++) {
      const actorIndex = leastUsedEligibleActor(actors, postIndex + likeIndex, postWritesByActor, selected);
      const actor = input.manifest.users[actorIndex]!;
      await postsService.like(actor.id, createdPosts[postIndex]!.id);
      postWritesByActor[actorIndex] = postWritesByActor[actorIndex]! + 1;
      selected.add(actorIndex);
      likes++;
    }
  }
  return { users: 12, friendships: accepted.length, pending: 5, posts: posts.length, comments: commentCount, likes };
}

function leastUsedEligibleActor(actors: number[], rotation: number, writes: number[], selected: Set<number>): number {
  const rotated = actors.map((_, offset) => actors[(rotation + offset) % actors.length]!).filter((actor) => !selected.has(actor));
  return rotated.reduce((best, actor) => writes[actor]! < writes[best]! ? actor : best);
}

function eligibleActorIndexes(
  visibility: 'members' | 'friends',
  authorIndex: number,
  accepted: Array<[number, number]>,
  userCount: number,
): number[] {
  const eligible = visibility === 'members'
    ? Array.from({ length: userCount }, (_, index) => index).filter((index) => index !== authorIndex)
    : accepted.flatMap(([a, b]) => a === authorIndex ? [b] : b === authorIndex ? [a] : []);
  return eligible;
}
