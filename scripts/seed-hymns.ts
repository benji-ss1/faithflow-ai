/**
 * Seeds a small, hand-verified library of public-domain hymns.
 *
 * Each title's public domain status has been individually verified:
 *  - Author died > 100 years ago (public domain in nearly all jurisdictions)
 *  - Text published before 1929 (US public domain by publication date rule)
 * Sources for lyrics: Cyber Hymnal (hymnary.org) and Wikisource, both of
 * which host lyrics only after clearing PD status themselves.
 *
 * If you need a hymn not on this list, verify PD status separately before
 * adding. Never blanket-import Cyber Hymnal — it hosts some non-PD content
 * behind fair-use claims.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { and, eq } from "drizzle-orm";
import { getDb } from "../src/lib/db/client";
import { churches, songs, songSlides } from "../src/lib/db/schema";

type Hymn = { title: string; author: string; verified: string; slides: string[] };

const HYMNS: Hymn[] = [
  {
    title: "Amazing Grace",
    author: "John Newton (1725–1807)",
    verified: "Newton's 1779 six-verse original + traditional 7th 'When we've been there…' verse (anon., pub. c.1829). All PD.",
    slides: [
      "Amazing grace! how sweet the sound,\nThat saved a wretch like me!\nI once was lost, but now am found;\nWas blind, but now I see.",
      "'Twas grace that taught my heart to fear,\nAnd grace my fears relieved;\nHow precious did that grace appear,\nThe hour I first believed!",
      "Through many dangers, toils and snares,\nI have already come;\n'Tis grace hath brought me safe thus far,\nAnd grace will lead me home.",
      "The Lord hath promised good to me,\nHis word my hope secures;\nHe will my shield and portion be\nAs long as life endures.",
      "Yea, when this flesh and heart shall fail,\nAnd mortal life shall cease,\nI shall possess, within the veil,\nA life of joy and peace.",
      "The earth shall soon dissolve like snow,\nThe sun forbear to shine;\nBut God, who called me here below,\nWill be forever mine.",
      "When we've been there ten thousand years,\nBright shining as the sun,\nWe've no less days to sing God's praise,\nThan when we'd first begun.",
    ],
  },
  {
    title: "How Great Thou Art",
    author: "Carl Boberg (1859–1940), trans. Stuart K. Hine",
    verified: "Boberg 1885 (Swedish). Hine's English 1949 is NOT PD — omit or restrict to Swedish original. Excluded from default seed.",
    slides: [], // intentionally empty to prevent accidental inclusion
  },
  {
    title: "Holy, Holy, Holy",
    author: "Reginald Heber (1783–1826)",
    verified: "Text 1826; author d. 1826. PD.",
    slides: [
      "Holy, holy, holy! Lord God Almighty!\nEarly in the morning our song shall rise to Thee;\nHoly, holy, holy! merciful and mighty,\nGod in three Persons, blessèd Trinity!",
      "Holy, holy, holy! all the saints adore Thee,\nCasting down their golden crowns around the glassy sea;\nCherubim and seraphim falling down before Thee,\nWho wert, and art, and evermore shalt be.",
      "Holy, holy, holy! though the darkness hide Thee,\nThough the eye of sinful man Thy glory may not see,\nOnly Thou art holy; there is none beside Thee,\nPerfect in power, in love, and purity.",
      "Holy, holy, holy! Lord God Almighty!\nAll Thy works shall praise Thy name, in earth, and sky, and sea;\nHoly, holy, holy! merciful and mighty,\nGod in three Persons, blessèd Trinity!",
    ],
  },
  {
    title: "It Is Well With My Soul",
    author: "Horatio Spafford (1828–1888)",
    verified: "Text 1873, pub. 1876; author d. 1888. PD.",
    slides: [
      "When peace like a river attendeth my way,\nWhen sorrows like sea billows roll;\nWhatever my lot, Thou hast taught me to say,\nIt is well, it is well with my soul.",
      "It is well with my soul,\nIt is well, it is well with my soul.",
      "Though Satan should buffet, though trials should come,\nLet this blest assurance control,\nThat Christ hath regarded my helpless estate,\nAnd hath shed His own blood for my soul.",
      "My sin, oh, the bliss of this glorious thought!\nMy sin, not in part but the whole,\nIs nailed to His cross, and I bear it no more,\nPraise the Lord, praise the Lord, O my soul!",
      "And Lord, haste the day when my faith shall be sight,\nThe clouds be rolled back as a scroll:\nThe trump shall resound, and the Lord shall descend,\nEven so, it is well with my soul.",
    ],
  },
  {
    title: "Come Thou Fount of Every Blessing",
    author: "Robert Robinson (1735–1790)",
    verified: "Text 1758; author d. 1790. PD.",
    slides: [
      "Come, thou Fount of every blessing,\nTune my heart to sing thy grace;\nStreams of mercy, never ceasing,\nCall for songs of loudest praise.",
      "Teach me some melodious sonnet,\nSung by flaming tongues above;\nPraise the mount! I'm fixed upon it,\nMount of God's unchanging love.",
      "Here I raise mine Ebenezer;\nHither by thy help I'm come;\nAnd I hope, by thy good pleasure,\nSafely to arrive at home.",
      "O to grace how great a debtor\nDaily I'm constrained to be!\nLet thy goodness, like a fetter,\nBind my wandering heart to thee.",
    ],
  },
  {
    title: "Great Is Thy Faithfulness",
    author: "Thomas Chisholm (1866–1960), music William M. Runyan",
    verified: "Published 1923 — US public domain (pre-1929 rule). PD status outside US varies by author death (Chisholm d. 1960 < 100 years) — flag for church review outside US.",
    slides: [
      "Great is Thy faithfulness, O God my Father,\nThere is no shadow of turning with Thee;\nThou changest not, Thy compassions, they fail not\nAs Thou hast been Thou forever wilt be.",
      "Great is Thy faithfulness! Great is Thy faithfulness!\nMorning by morning new mercies I see;\nAll I have needed Thy hand hath provided—\nGreat is Thy faithfulness, Lord, unto me!",
      "Summer and winter, and springtime and harvest,\nSun, moon and stars in their courses above,\nJoin with all nature in manifold witness\nTo Thy great faithfulness, mercy and love.",
      "Pardon for sin and a peace that endureth,\nThine own dear presence to cheer and to guide;\nStrength for today and bright hope for tomorrow,\nBlessings all mine, with ten thousand beside!",
    ],
  },
  {
    title: "Be Thou My Vision",
    author: "8th-century Irish; trans. Mary E. Byrne (1905), versified Eleanor H. Hull (1912)",
    verified: "Original text ancient. Byrne/Hull English versification pub. 1912. PD by pub. date + author death (Hull d. 1935 > 90 years).",
    slides: [
      "Be Thou my Vision, O Lord of my heart;\nNaught be all else to me, save that Thou art;\nThou my best thought, by day or by night,\nWaking or sleeping, Thy presence my light.",
      "Be Thou my Wisdom, and Thou my true Word;\nI ever with Thee and Thou with me, Lord;\nThou my great Father, I Thy true son;\nThou in me dwelling, and I with Thee one.",
      "Riches I heed not, nor man's empty praise,\nThou mine Inheritance, now and always:\nThou and Thou only, first in my heart,\nHigh King of Heaven, my Treasure Thou art.",
      "High King of Heaven, my victory won,\nMay I reach Heaven's joys, O bright Heaven's Sun!\nHeart of my own heart, whatever befall,\nStill be my Vision, O Ruler of all.",
    ],
  },
  {
    title: "Crown Him with Many Crowns",
    author: "Matthew Bridges (1800–1894) and Godfrey Thring (1823–1903)",
    verified: "Text 1851/1874. Both authors d. > 120 years ago. PD.",
    slides: [
      "Crown Him with many crowns, the Lamb upon His throne;\nHark, how the heavenly anthem drowns all music but its own!\nAwake, my soul, and sing of Him who died for thee,\nAnd hail Him as thy matchless King through all eternity.",
      "Crown Him the Lord of love, behold His hands and side,\nThose wounds, yet visible above, in beauty glorified.\nNo angel in the sky can fully bear that sight,\nBut downward bends His burning eye at mysteries so bright.",
      "Crown Him the Lord of life, who triumphed o'er the grave,\nAnd rose victorious in the strife for those He came to save;\nHis glories now we sing who died, and rose on high,\nWho died eternal life to bring, and lives that death may die.",
      "Crown Him the Lord of peace, whose power a sceptre sways\nFrom pole to pole, that wars may cease, absorbed in prayer and praise:\nHis reign shall know no end, and round His piercèd feet\nFair flowers of paradise extend their fragrance ever sweet.",
      "Crown Him the Lord of years, the Potentate of time,\nCreator of the rolling spheres, ineffably sublime.\nAll hail, Redeemer, hail! for Thou hast died for me;\nThy praise and glory shall not fail throughout eternity.",
    ],
  },
  {
    title: "All Hail the Power of Jesus' Name",
    author: "Edward Perronet (1726–1792)",
    verified: "Text 1779; author d. 1792. PD.",
    slides: [
      "All hail the power of Jesus' name!\nLet angels prostrate fall;\nBring forth the royal diadem,\nAnd crown Him Lord of all!",
      "Ye chosen seed of Israel's race,\nYe ransomed from the fall,\nHail Him who saves you by His grace,\nAnd crown Him Lord of all!",
      "Let every kindred, every tribe\nOn this terrestrial ball,\nTo Him all majesty ascribe,\nAnd crown Him Lord of all!",
      "O that with yonder sacred throng\nWe at His feet may fall!\nWe'll join the everlasting song,\nAnd crown Him Lord of all!",
    ],
  },
  {
    title: "A Mighty Fortress Is Our God",
    author: "Martin Luther (1483–1546), trans. Frederick H. Hedge",
    verified: "Original 1529. Hedge translation 1853. Both PD.",
    slides: [
      "A mighty fortress is our God,\nA bulwark never failing;\nOur helper He, amid the flood\nOf mortal ills prevailing.",
      "For still our ancient foe\nDoth seek to work us woe;\nHis craft and power are great,\nAnd, armed with cruel hate,\nOn earth is not his equal.",
      "Did we in our own strength confide,\nOur striving would be losing;\nWere not the right Man on our side,\nThe Man of God's own choosing.",
      "Dost ask who that may be? Christ Jesus, it is He;\nLord Sabaoth His name, from age to age the same,\nAnd He must win the battle.",
      "And though this world, with devils filled,\nShould threaten to undo us,\nWe will not fear, for God hath willed\nHis truth to triumph through us.",
      "The Prince of Darkness grim,\nWe tremble not for him;\nHis rage we can endure,\nFor lo! his doom is sure,\nOne little word shall fell him.",
      "That word above all earthly powers,\nNo thanks to them, abideth;\nThe Spirit and the gifts are ours\nThrough Him who with us sideth.",
      "Let goods and kindred go,\nThis mortal life also;\nThe body they may kill:\nGod's truth abideth still,\nHis kingdom is forever.",
    ],
  },
  {
    title: "When I Survey the Wondrous Cross",
    author: "Isaac Watts (1674–1748)",
    verified: "Text 1707. PD.",
    slides: [
      "When I survey the wondrous cross\nOn which the Prince of Glory died,\nMy richest gain I count but loss,\nAnd pour contempt on all my pride.",
      "Forbid it, Lord, that I should boast,\nSave in the death of Christ, my God;\nAll the vain things that charm me most,\nI sacrifice them to His blood.",
      "See, from His head, His hands, His feet,\nSorrow and love flow mingled down;\nDid e'er such love and sorrow meet,\nOr thorns compose so rich a crown?",
      "Were the whole realm of nature mine,\nThat were a present far too small;\nLove so amazing, so divine,\nDemands my soul, my life, my all.",
    ],
  },
  {
    title: "Joy to the World",
    author: "Isaac Watts (1674–1748)",
    verified: "Text 1719 (paraphrase of Psalm 98). PD.",
    slides: [
      "Joy to the world! the Lord is come:\nLet earth receive her King;\nLet every heart prepare Him room,\nAnd heaven and nature sing.",
      "Joy to the earth! the Savior reigns:\nLet men their songs employ;\nWhile fields and floods, rocks, hills and plains,\nRepeat the sounding joy.",
      "No more let sins and sorrows grow,\nNor thorns infest the ground;\nHe comes to make His blessings flow\nFar as the curse is found.",
      "He rules the world with truth and grace,\nAnd makes the nations prove\nThe glories of His righteousness,\nAnd wonders of His love.",
    ],
  },
  {
    title: "O Come, All Ye Faithful",
    author: "John Francis Wade (1711–1786), tr. Frederick Oakeley (1841)",
    verified: "Latin 1751; Oakeley translation 1841. PD.",
    slides: [
      "O come, all ye faithful,\nJoyful and triumphant,\nO come ye, O come ye to Bethlehem;\nCome and behold Him,\nBorn the King of angels.",
      "O come, let us adore Him,\nO come, let us adore Him,\nO come, let us adore Him,\nChrist the Lord.",
      "Sing, choirs of angels,\nSing in exultation,\nSing all ye citizens of heaven above;\nGlory to God,\nAll glory in the highest.",
      "Yea, Lord, we greet Thee,\nBorn this happy morning,\nJesus, to Thee be all glory given;\nWord of the Father,\nNow in flesh appearing.",
    ],
  },
  {
    title: "Silent Night",
    author: "Joseph Mohr (1792–1848), tr. John Freeman Young (1859)",
    verified: "Original 1816; Young translation 1859. PD.",
    slides: [
      "Silent night, holy night,\nAll is calm, all is bright\nRound yon virgin mother and Child.\nHoly Infant so tender and mild,\nSleep in heavenly peace,\nSleep in heavenly peace.",
      "Silent night, holy night,\nShepherds quake at the sight;\nGlories stream from heaven afar,\nHeavenly hosts sing Alleluia!\nChrist the Savior is born,\nChrist the Savior is born!",
      "Silent night, holy night,\nSon of God, love's pure light;\nRadiant beams from Thy holy face\nWith the dawn of redeeming grace,\nJesus, Lord, at Thy birth,\nJesus, Lord, at Thy birth.",
    ],
  },
  {
    title: "Hark! The Herald Angels Sing",
    author: "Charles Wesley (1707–1788)",
    verified: "Text 1739, revised George Whitefield 1758. PD.",
    slides: [
      "Hark! the herald angels sing,\n\"Glory to the newborn King;\nPeace on earth, and mercy mild,\nGod and sinners reconciled!\"",
      "Joyful, all ye nations rise,\nJoin the triumph of the skies;\nWith th'angelic host proclaim,\n\"Christ is born in Bethlehem!\"\nHark! the herald angels sing,\n\"Glory to the newborn King!\"",
      "Christ, by highest heaven adored;\nChrist, the everlasting Lord;\nLate in time behold Him come,\nOffspring of the Virgin's womb.",
      "Hail the heaven-born Prince of Peace!\nHail the Sun of Righteousness!\nLight and life to all He brings,\nRisen with healing in His wings.",
    ],
  },
  {
    title: "O Little Town of Bethlehem",
    author: "Phillips Brooks (1835–1893)",
    verified: "Text 1868. PD.",
    slides: [
      "O little town of Bethlehem,\nHow still we see thee lie;\nAbove thy deep and dreamless sleep\nThe silent stars go by;\nYet in thy dark streets shineth\nThe everlasting Light;\nThe hopes and fears of all the years\nAre met in thee tonight.",
      "For Christ is born of Mary,\nAnd gathered all above,\nWhile mortals sleep, the angels keep\nTheir watch of wondering love.\nO morning stars, together\nProclaim the holy birth,\nAnd praises sing to God the King,\nAnd peace to men on earth.",
      "How silently, how silently,\nThe wondrous Gift is given!\nSo God imparts to human hearts\nThe blessings of His heaven.\nNo ear may hear His coming,\nBut in this world of sin,\nWhere meek souls will receive Him, still\nThe dear Christ enters in.",
      "O holy Child of Bethlehem,\nDescend to us, we pray;\nCast out our sin and enter in;\nBe born in us today.\nWe hear the Christmas angels\nThe great glad tidings tell;\nO come to us, abide with us,\nOur Lord Emmanuel.",
    ],
  },
  {
    title: "Away in a Manger",
    author: "Anonymous (US, pub. 1885)",
    verified: "First publication 1885 in Philadelphia. PD.",
    slides: [
      "Away in a manger, no crib for a bed,\nThe little Lord Jesus laid down His sweet head.\nThe stars in the bright sky looked down where He lay,\nThe little Lord Jesus, asleep on the hay.",
      "The cattle are lowing, the poor Baby wakes,\nBut little Lord Jesus, no crying He makes.\nI love Thee, Lord Jesus! Look down from the sky,\nAnd stay by my cradle till morning is nigh.",
      "Be near me, Lord Jesus; I ask Thee to stay\nClose by me forever, and love me, I pray.\nBless all the dear children in Thy tender care,\nAnd fit us for heaven, to live with Thee there.",
    ],
  },
  {
    title: "What Child Is This",
    author: "William Chatterton Dix (1837–1898)",
    verified: "Text 1865. PD.",
    slides: [
      "What Child is this, who, laid to rest,\nOn Mary's lap is sleeping?\nWhom angels greet with anthems sweet,\nWhile shepherds watch are keeping?",
      "This, this is Christ the King,\nWhom shepherds guard and angels sing:\nHaste, haste to bring Him laud,\nThe Babe, the Son of Mary.",
      "Why lies He in such mean estate\nWhere ox and ass are feeding?\nGood Christian, fear: for sinners here\nThe silent Word is pleading.",
      "So bring Him incense, gold, and myrrh,\nCome, peasant, king to own Him;\nThe King of kings salvation brings,\nLet loving hearts enthrone Him.",
    ],
  },
  {
    title: "The First Noel",
    author: "English traditional (17th c., pub. 1833)",
    verified: "First published Sandys 1833; traditional carol. PD.",
    slides: [
      "The first Noel the angel did say\nWas to certain poor shepherds in fields as they lay;\nIn fields where they lay keeping their sheep,\nOn a cold winter's night that was so deep.",
      "Noel, Noel, Noel, Noel,\nBorn is the King of Israel.",
      "They looked up and saw a star\nShining in the east, beyond them far;\nAnd to the earth it gave great light,\nAnd so it continued both day and night.",
      "And by the light of that same star\nThree wise men came from country far;\nTo seek for a King was their intent,\nAnd to follow the star wherever it went.",
      "Then let us all with one accord\nSing praises to our heavenly Lord\nThat hath made heaven and earth of naught,\nAnd with His blood mankind hath bought.",
    ],
  },
  {
    title: "Angels We Have Heard on High",
    author: "French traditional, tr. James Chadwick (1862)",
    verified: "French Les Anges dans nos campagnes 1862; Chadwick English 1862. PD.",
    slides: [
      "Angels we have heard on high\nSweetly singing o'er the plains,\nAnd the mountains in reply\nEchoing their joyous strains.",
      "Gloria, in excelsis Deo!\nGloria, in excelsis Deo!",
      "Shepherds, why this jubilee?\nWhy your joyous strains prolong?\nWhat the gladsome tidings be\nWhich inspire your heavenly song?",
      "Come to Bethlehem and see\nHim whose birth the angels sing;\nCome, adore on bended knee,\nChrist the Lord, the newborn King.",
    ],
  },
  {
    title: "We Three Kings",
    author: "John Henry Hopkins Jr. (1820–1891)",
    verified: "Text 1857. PD.",
    slides: [
      "We three kings of Orient are;\nBearing gifts we traverse afar,\nField and fountain, moor and mountain,\nFollowing yonder star.",
      "O star of wonder, star of night,\nStar with royal beauty bright,\nWestward leading, still proceeding,\nGuide us to thy perfect light.",
      "Born a King on Bethlehem's plain,\nGold I bring to crown Him again,\nKing forever, ceasing never\nOver us all to reign.",
      "Frankincense to offer have I;\nIncense owns a Deity nigh:\nPrayer and praising, all men raising,\nWorship Him, God most high.",
      "Myrrh is mine; its bitter perfume\nBreathes a life of gathering gloom;\nSorrowing, sighing, bleeding, dying,\nSealed in the stone-cold tomb.",
      "Glorious now behold Him arise,\nKing and God and Sacrifice!\nAlleluia, alleluia!\nSounds through the earth and skies.",
    ],
  },
  {
    title: "It Came Upon the Midnight Clear",
    author: "Edmund Sears (1810–1876)",
    verified: "Text 1849. PD.",
    slides: [
      "It came upon the midnight clear,\nThat glorious song of old,\nFrom angels bending near the earth\nTo touch their harps of gold:\n\"Peace on the earth, good will to men,\nFrom heaven's all-gracious King.\"\nThe world in solemn stillness lay\nTo hear the angels sing.",
      "Still through the cloven skies they come\nWith peaceful wings unfurled,\nAnd still their heavenly music floats\nO'er all the weary world;\nAbove its sad and lowly plains\nThey bend on hovering wing,\nAnd ever o'er its Babel sounds\nThe blessed angels sing.",
      "For lo! the days are hastening on,\nBy prophet bards foretold,\nWhen with the ever-circling years\nComes round the age of gold;\nWhen peace shall over all the earth\nIts ancient splendors fling,\nAnd the whole world give back the song\nWhich now the angels sing.",
    ],
  },
  {
    title: "God Rest Ye Merry, Gentlemen",
    author: "English traditional (pub. 1833)",
    verified: "First published Sandys 1833; traditional 16th c. carol. PD.",
    slides: [
      "God rest ye merry, gentlemen,\nLet nothing you dismay,\nRemember Christ our Savior\nWas born on Christmas Day,\nTo save us all from Satan's power\nWhen we were gone astray.",
      "O tidings of comfort and joy,\nComfort and joy,\nO tidings of comfort and joy.",
      "From God our Heavenly Father\nA blessed angel came,\nAnd unto certain shepherds\nBrought tidings of the same,\nHow that in Bethlehem was born\nThe Son of God by name.",
      "\"Fear not,\" then said the angel,\n\"Let nothing you affright,\nThis day is born a Savior\nOf virtue, power, and might;\nSo frequently to vanquish all\nThe friends of Satan quite.\"",
    ],
  },
  {
    title: "Christ the Lord Is Risen Today",
    author: "Charles Wesley (1707–1788)",
    verified: "Text 1739. PD.",
    slides: [
      "Christ the Lord is risen today, Alleluia!\nSons of men and angels say: Alleluia!\nRaise your joys and triumphs high: Alleluia!\nSing, ye heavens; thou earth, reply: Alleluia!",
      "Love's redeeming work is done, Alleluia!\nFought the fight, the battle won: Alleluia!\nDeath in vain forbids Him rise: Alleluia!\nChrist has opened paradise: Alleluia!",
      "Lives again our glorious King, Alleluia!\nWhere, O death, is now thy sting? Alleluia!\nOnce He died our souls to save: Alleluia!\nWhere's thy victory, boasting grave? Alleluia!",
      "Soar we now where Christ has led, Alleluia!\nFollowing our exalted Head: Alleluia!\nMade like Him, like Him we rise: Alleluia!\nOurs the cross, the grave, the skies: Alleluia!",
    ],
  },
  {
    title: "Low in the Grave He Lay",
    author: "Robert Lowry (1826–1899)",
    verified: "Text 1874. PD.",
    slides: [
      "Low in the grave He lay,\nJesus, my Savior;\nWaiting the coming day,\nJesus, my Lord.",
      "Up from the grave He arose,\nWith a mighty triumph o'er His foes;\nHe arose a Victor from the dark domain,\nAnd He lives forever with His saints to reign:\nHe arose! He arose!\nHallelujah! Christ arose!",
      "Vainly they watch His bed,\nJesus, my Savior;\nVainly they seal the dead,\nJesus, my Lord.",
      "Death cannot keep his prey,\nJesus, my Savior;\nHe tore the bars away,\nJesus, my Lord.",
    ],
  },
  {
    title: "The Old Rugged Cross",
    author: "George Bennard (1873–1958)",
    verified: "Text and music 1913. US public domain (pre-1929 rule). Outside US, PD in most jurisdictions (author d. 1958).",
    slides: [
      "On a hill far away stood an old rugged cross,\nThe emblem of suffering and shame;\nAnd I love that old cross where the dearest and best\nFor a world of lost sinners was slain.",
      "So I'll cherish the old rugged cross,\nTill my trophies at last I lay down;\nI will cling to the old rugged cross,\nAnd exchange it some day for a crown.",
      "O that old rugged cross, so despised by the world,\nHas a wondrous attraction for me;\nFor the dear Lamb of God left His glory above\nTo bear it to dark Calvary.",
      "In that old rugged cross, stained with blood so divine,\nA wondrous beauty I see;\nFor 'twas on that old cross Jesus suffered and died,\nTo pardon and sanctify me.",
      "To the old rugged cross I will ever be true,\nIts shame and reproach gladly bear;\nThen He'll call me some day to my home far away,\nWhere His glory forever I'll share.",
    ],
  },
  {
    title: "Blessed Assurance",
    author: "Fanny Crosby (1820–1915)",
    verified: "Text 1873. PD.",
    slides: [
      "Blessed assurance, Jesus is mine!\nO what a foretaste of glory divine!\nHeir of salvation, purchase of God,\nBorn of His Spirit, washed in His blood.",
      "This is my story, this is my song,\nPraising my Savior all the day long;\nThis is my story, this is my song,\nPraising my Savior all the day long.",
      "Perfect submission, perfect delight,\nVisions of rapture now burst on my sight;\nAngels descending bring from above\nEchoes of mercy, whispers of love.",
      "Perfect submission, all is at rest,\nI in my Savior am happy and blest;\nWatching and waiting, looking above,\nFilled with His goodness, lost in His love.",
    ],
  },
  {
    title: "To God Be the Glory",
    author: "Fanny Crosby (1820–1915)",
    verified: "Text 1875. PD.",
    slides: [
      "To God be the glory, great things He hath done;\nSo loved He the world that He gave us His Son,\nWho yielded His life an atonement for sin,\nAnd opened the life-gate that all may go in.",
      "Praise the Lord, praise the Lord,\nLet the earth hear His voice!\nPraise the Lord, praise the Lord,\nLet the people rejoice!\nO come to the Father, through Jesus the Son,\nAnd give Him the glory, great things He hath done.",
      "O perfect redemption, the purchase of blood,\nTo every believer the promise of God;\nThe vilest offender who truly believes,\nThat moment from Jesus a pardon receives.",
      "Great things He hath taught us, great things He hath done,\nAnd great our rejoicing through Jesus the Son;\nBut purer, and higher, and greater will be\nOur wonder, our transport, when Jesus we see.",
    ],
  },
  {
    title: "Praise to the Lord, the Almighty",
    author: "Joachim Neander (1650–1680), tr. Catherine Winkworth (1863)",
    verified: "Original 1680; Winkworth translation 1863. PD.",
    slides: [
      "Praise to the Lord, the Almighty, the King of creation!\nO my soul, praise Him, for He is thy health and salvation!\nAll ye who hear,\nNow to His temple draw near;\nJoin me in glad adoration!",
      "Praise to the Lord, who o'er all things so wondrously reigneth,\nShelters thee under His wings, yea, so gently sustaineth!\nHast thou not seen\nHow thy desires e'er have been\nGranted in what He ordaineth?",
      "Praise to the Lord, who doth prosper thy work and defend thee;\nSurely His goodness and mercy here daily attend thee.\nPonder anew\nWhat the Almighty can do,\nIf with His love He befriend thee.",
      "Praise to the Lord, O let all that is in me adore Him!\nAll that hath life and breath, come now with praises before Him.\nLet the Amen\nSound from His people again,\nGladly for aye we adore Him.",
    ],
  },
  {
    title: "Doxology (Praise God, from Whom All Blessings Flow)",
    author: "Thomas Ken (1637–1711)",
    verified: "Text 1674. PD.",
    slides: [
      "Praise God, from whom all blessings flow;\nPraise Him, all creatures here below;\nPraise Him above, ye heavenly host;\nPraise Father, Son, and Holy Ghost.\nAmen.",
    ],
  },
  {
    title: "Gloria Patri",
    author: "Traditional (ancient)",
    verified: "Text: 2nd–4th century Latin liturgy; English form 16th century. PD.",
    slides: [
      "Glory be to the Father,\nAnd to the Son,\nAnd to the Holy Ghost;\nAs it was in the beginning,\nIs now, and ever shall be,\nWorld without end. Amen. Amen.",
    ],
  },
  {
    title: "Fairest Lord Jesus",
    author: "Anonymous (German, 1677); tr. from Münster Gesangbuch",
    verified: "German original 1677; English translation 19th century. PD.",
    slides: [
      "Fairest Lord Jesus, Ruler of all nature,\nO Thou of God and man the Son;\nThee will I cherish, Thee will I honor,\nThou, my soul's glory, joy, and crown.",
      "Fair are the meadows, fairer still the woodlands,\nRobed in the blooming garb of spring:\nJesus is fairer, Jesus is purer,\nWho makes the woeful heart to sing.",
      "Fair is the sunshine, fairer still the moonlight,\nAnd all the twinkling starry host:\nJesus shines brighter, Jesus shines purer\nThan all the angels heaven can boast.",
      "Beautiful Savior! Lord of all the nations!\nSon of God and Son of Man!\nGlory and honor, praise, adoration,\nNow and forevermore be Thine!",
    ],
  },
  {
    title: "Immortal, Invisible, God Only Wise",
    author: "Walter Chalmers Smith (1824–1908)",
    verified: "Text 1867. PD.",
    slides: [
      "Immortal, invisible, God only wise,\nIn light inaccessible hid from our eyes,\nMost blessed, most glorious, the Ancient of Days,\nAlmighty, victorious, Thy great name we praise.",
      "Unresting, unhasting, and silent as light,\nNor wanting, nor wasting, Thou rulest in might;\nThy justice like mountains high soaring above\nThy clouds, which are fountains of goodness and love.",
      "To all life Thou givest, to both great and small;\nIn all life Thou livest, the true life of all;\nWe blossom and flourish as leaves on the tree,\nAnd wither and perish; but naught changeth Thee.",
      "Great Father of glory, pure Father of light,\nThine angels adore Thee, all veiling their sight;\nAll laud we would render: O help us to see\n'Tis only the splendor of light hideth Thee.",
    ],
  },
  {
    title: "Rock of Ages",
    author: "Augustus Toplady (1740–1778)",
    verified: "Text 1776. PD.",
    slides: [
      "Rock of Ages, cleft for me,\nLet me hide myself in Thee;\nLet the water and the blood,\nFrom Thy wounded side which flowed,\nBe of sin the double cure,\nSave from wrath and make me pure.",
      "Not the labor of my hands\nCan fulfill Thy law's demands;\nCould my zeal no respite know,\nCould my tears forever flow,\nAll for sin could not atone;\nThou must save, and Thou alone.",
      "Nothing in my hand I bring,\nSimply to Thy cross I cling;\nNaked, come to Thee for dress;\nHelpless, look to Thee for grace;\nFoul, I to the fountain fly;\nWash me, Savior, or I die.",
      "While I draw this fleeting breath,\nWhen my eyes shall close in death,\nWhen I soar to worlds unknown,\nSee Thee on Thy judgment throne,\nRock of Ages, cleft for me,\nLet me hide myself in Thee.",
    ],
  },
  {
    title: "Just As I Am",
    author: "Charlotte Elliott (1789–1871)",
    verified: "Text 1835. PD.",
    slides: [
      "Just as I am, without one plea,\nBut that Thy blood was shed for me,\nAnd that Thou bidst me come to Thee,\nO Lamb of God, I come, I come.",
      "Just as I am, and waiting not\nTo rid my soul of one dark blot,\nTo Thee whose blood can cleanse each spot,\nO Lamb of God, I come, I come.",
      "Just as I am, though tossed about\nWith many a conflict, many a doubt,\nFightings and fears within, without,\nO Lamb of God, I come, I come.",
      "Just as I am, poor, wretched, blind;\nSight, riches, healing of the mind;\nYea, all I need, in Thee to find,\nO Lamb of God, I come, I come.",
      "Just as I am, Thou wilt receive,\nWilt welcome, pardon, cleanse, relieve;\nBecause Thy promise I believe,\nO Lamb of God, I come, I come.",
    ],
  },
  {
    title: "I Need Thee Every Hour",
    author: "Annie S. Hawks (1835–1918)",
    verified: "Text 1872. PD.",
    slides: [
      "I need Thee every hour, most gracious Lord;\nNo tender voice like Thine can peace afford.",
      "I need Thee, O I need Thee;\nEvery hour I need Thee!\nO bless me now, my Savior,\nI come to Thee.",
      "I need Thee every hour, stay Thou nearby;\nTemptations lose their power when Thou art nigh.",
      "I need Thee every hour, in joy or pain;\nCome quickly and abide, or life is vain.",
      "I need Thee every hour, most Holy One;\nO make me Thine indeed, Thou blessed Son.",
    ],
  },
  {
    title: "Take My Life and Let It Be",
    author: "Frances R. Havergal (1836–1879)",
    verified: "Text 1874. PD.",
    slides: [
      "Take my life, and let it be\nConsecrated, Lord, to Thee;\nTake my moments and my days,\nLet them flow in ceaseless praise.",
      "Take my hands, and let them move\nAt the impulse of Thy love;\nTake my feet, and let them be\nSwift and beautiful for Thee.",
      "Take my voice, and let me sing\nAlways, only, for my King;\nTake my lips, and let them be\nFilled with messages from Thee.",
      "Take my silver and my gold,\nNot a mite would I withhold;\nTake my intellect, and use\nEvery power as Thou shalt choose.",
      "Take my will, and make it Thine,\nIt shall be no longer mine;\nTake my heart, it is Thine own,\nIt shall be Thy royal throne.",
      "Take my love; my Lord, I pour\nAt Thy feet its treasure store;\nTake myself, and I will be\nEver, only, all for Thee.",
    ],
  },
  {
    title: "Sweet Hour of Prayer",
    author: "William W. Walford (1772–1850)",
    verified: "Text 1845. PD.",
    slides: [
      "Sweet hour of prayer! sweet hour of prayer!\nThat calls me from a world of care,\nAnd bids me at my Father's throne\nMake all my wants and wishes known.\nIn seasons of distress and grief,\nMy soul has often found relief,\nAnd oft escaped the tempter's snare,\nBy thy return, sweet hour of prayer!",
      "Sweet hour of prayer! sweet hour of prayer!\nThe joys I feel, the bliss I share,\nOf those whose anxious spirits burn\nWith strong desires for thy return!\nWith such I hasten to the place\nWhere God my Savior shows His face,\nAnd gladly take my station there,\nAnd wait for thee, sweet hour of prayer!",
      "Sweet hour of prayer! sweet hour of prayer!\nThy wings shall my petition bear\nTo Him whose truth and faithfulness\nEngage the waiting soul to bless.\nAnd since He bids me seek His face,\nBelieve His word, and trust His grace,\nI'll cast on Him my every care,\nAnd wait for thee, sweet hour of prayer!",
    ],
  },
  {
    title: "What a Friend We Have in Jesus",
    author: "Joseph M. Scriven (1819–1886)",
    verified: "Text 1855. PD.",
    slides: [
      "What a friend we have in Jesus,\nAll our sins and griefs to bear!\nWhat a privilege to carry\nEverything to God in prayer!\nO what peace we often forfeit,\nO what needless pain we bear,\nAll because we do not carry\nEverything to God in prayer!",
      "Have we trials and temptations?\nIs there trouble anywhere?\nWe should never be discouraged;\nTake it to the Lord in prayer.\nCan we find a friend so faithful,\nWho will all our sorrows share?\nJesus knows our every weakness;\nTake it to the Lord in prayer.",
      "Are we weak and heavy laden,\nCumbered with a load of care?\nPrecious Savior, still our refuge,\nTake it to the Lord in prayer.\nDo thy friends despise, forsake thee?\nTake it to the Lord in prayer!\nIn His arms He'll take and shield thee,\nThou wilt find a solace there.",
    ],
  },
  {
    title: "Nearer, My God, to Thee",
    author: "Sarah F. Adams (1805–1848)",
    verified: "Text 1841. PD.",
    slides: [
      "Nearer, my God, to Thee, nearer to Thee!\nE'en though it be a cross that raiseth me;\nStill all my song shall be, nearer, my God, to Thee,\nNearer, my God, to Thee, nearer to Thee!",
      "Though like the wanderer, the sun gone down,\nDarkness be over me, my rest a stone;\nYet in my dreams I'd be nearer, my God, to Thee,\nNearer, my God, to Thee, nearer to Thee!",
      "There let the way appear, steps unto heaven;\nAll that Thou sendest me, in mercy given;\nAngels to beckon me nearer, my God, to Thee,\nNearer, my God, to Thee, nearer to Thee!",
      "Then, with my waking thoughts bright with Thy praise,\nOut of my stony griefs Bethel I'll raise;\nSo by my woes to be nearer, my God, to Thee,\nNearer, my God, to Thee, nearer to Thee!",
    ],
  },
  {
    title: "Abide With Me",
    author: "Henry F. Lyte (1793–1847)",
    verified: "Text 1847. PD.",
    slides: [
      "Abide with me; fast falls the eventide;\nThe darkness deepens; Lord with me abide.\nWhen other helpers fail and comforts flee,\nHelp of the helpless, O abide with me.",
      "Swift to its close ebbs out life's little day;\nEarth's joys grow dim; its glories pass away;\nChange and decay in all around I see;\nO Thou who changest not, abide with me.",
      "I need Thy presence every passing hour.\nWhat but Thy grace can foil the tempter's power?\nWho, like Thyself, my guide and stay can be?\nThrough cloud and sunshine, Lord, abide with me.",
      "I fear no foe, with Thee at hand to bless;\nIlls have no weight, and tears no bitterness.\nWhere is death's sting? Where, grave, thy victory?\nI triumph still, if Thou abide with me.",
      "Hold Thou Thy cross before my closing eyes;\nShine through the gloom and point me to the skies.\nHeaven's morning breaks, and earth's vain shadows flee;\nIn life, in death, O Lord, abide with me.",
    ],
  },
  {
    title: "Turn Your Eyes Upon Jesus",
    author: "Helen H. Lemmel (1863–1961)",
    verified: "Text 1922. US public domain (pre-1929 rule). Outside US, verify per jurisdiction (author d. 1961).",
    slides: [
      "O soul, are you weary and troubled?\nNo light in the darkness you see?\nThere's light for a look at the Savior,\nAnd life more abundant and free!",
      "Turn your eyes upon Jesus,\nLook full in His wonderful face,\nAnd the things of earth will grow strangely dim,\nIn the light of His glory and grace.",
      "Through death into life everlasting\nHe passed, and we follow Him there;\nO'er us sin no more hath dominion,\nFor more than conquerors we are!",
      "His word shall not fail you, He promised;\nBelieve Him, and all will be well;\nThen go to a world that is dying,\nHis perfect salvation to tell!",
    ],
  },
  {
    title: "Jesus Loves Me",
    author: "Anna Bartlett Warner (1827–1915)",
    verified: "Text 1859. PD.",
    slides: [
      "Jesus loves me! This I know,\nFor the Bible tells me so;\nLittle ones to Him belong,\nThey are weak, but He is strong.",
      "Yes, Jesus loves me!\nYes, Jesus loves me!\nYes, Jesus loves me!\nThe Bible tells me so.",
      "Jesus loves me! He who died\nHeaven's gate to open wide;\nHe will wash away my sin,\nLet His little child come in.",
      "Jesus loves me! Loves me still,\nThough I'm very weak and ill;\nFrom His shining throne on high\nComes to watch me where I lie.",
      "Jesus loves me! He will stay\nClose beside me all the way;\nThou hast bled and died for me;\nI will henceforth live for Thee.",
    ],
  },
  {
    title: "This Little Light of Mine",
    author: "African-American spiritual (traditional)",
    verified: "Traditional spiritual, pre-1920 origin. PD.",
    slides: [
      "This little light of mine,\nI'm gonna let it shine.\nThis little light of mine,\nI'm gonna let it shine.\nThis little light of mine,\nI'm gonna let it shine,\nLet it shine, let it shine, let it shine.",
      "Everywhere I go,\nI'm gonna let it shine.\nEverywhere I go,\nI'm gonna let it shine.\nEverywhere I go,\nI'm gonna let it shine,\nLet it shine, let it shine, let it shine.",
      "Hide it under a bushel? No!\nI'm gonna let it shine.\nHide it under a bushel? No!\nI'm gonna let it shine.\nHide it under a bushel? No!\nI'm gonna let it shine,\nLet it shine, let it shine, let it shine.",
      "Don't let Satan blow it out,\nI'm gonna let it shine.\nDon't let Satan blow it out,\nI'm gonna let it shine.\nDon't let Satan blow it out,\nI'm gonna let it shine,\nLet it shine, let it shine, let it shine.",
    ],
  },
  {
    title: "Onward, Christian Soldiers",
    author: "Sabine Baring-Gould (1834–1924)",
    verified: "Text 1865. PD.",
    slides: [
      "Onward, Christian soldiers, marching as to war,\nWith the cross of Jesus going on before!\nChrist, the royal Master, leads against the foe;\nForward into battle, see His banners go!",
      "Onward, Christian soldiers, marching as to war,\nWith the cross of Jesus going on before!",
      "At the sign of triumph Satan's host doth flee;\nOn then, Christian soldiers, on to victory!\nHell's foundations quiver at the shout of praise;\nBrothers, lift your voices, loud your anthems raise.",
      "Like a mighty army moves the Church of God;\nBrothers, we are treading where the saints have trod;\nWe are not divided; all one body we,\nOne in hope and doctrine, one in charity.",
      "Onward, then, ye people, join our happy throng,\nBlend with ours your voices in the triumph song;\nGlory, laud, and honor unto Christ the King;\nThis through countless ages men and angels sing.",
    ],
  },
  {
    title: "All the Way My Savior Leads Me",
    author: "Fanny Crosby (1820–1915)",
    verified: "Text 1875. PD.",
    slides: [
      "All the way my Savior leads me;\nWhat have I to ask beside?\nCan I doubt His tender mercy,\nWho through life has been my Guide?\nHeavenly peace, divinest comfort,\nHere by faith in Him to dwell!\nFor I know, whate'er befall me,\nJesus doeth all things well.",
      "All the way my Savior leads me,\nCheers each winding path I tread;\nGives me grace for every trial,\nFeeds me with the living Bread.\nThough my weary steps may falter,\nAnd my soul athirst may be,\nGushing from the Rock before me,\nLo! a spring of joy I see.",
      "All the way my Savior leads me;\nO the fullness of His love!\nPerfect rest to me is promised\nIn my Father's house above.\nWhen my spirit, clothed immortal,\nWings its flight to realms of day,\nThis my song through endless ages:\nJesus led me all the way.",
    ],
  },
  {
    title: "My Faith Looks Up to Thee",
    author: "Ray Palmer (1808–1887)",
    verified: "Text 1830. PD.",
    slides: [
      "My faith looks up to Thee,\nThou Lamb of Calvary,\nSavior divine;\nNow hear me while I pray,\nTake all my guilt away,\nO let me from this day\nBe wholly Thine!",
      "May Thy rich grace impart\nStrength to my fainting heart,\nMy zeal inspire!\nAs Thou hast died for me,\nO may my love to Thee\nPure, warm, and changeless be,\nA living fire!",
      "While life's dark maze I tread,\nAnd griefs around me spread,\nBe Thou my Guide;\nBid darkness turn to day,\nWipe sorrow's tears away,\nNor let me ever stray\nFrom Thee aside.",
      "When ends life's transient dream,\nWhen death's cold sullen stream\nShall o'er me roll;\nBlest Savior, then, in love,\nFear and distrust remove;\nO bear me safe above,\nA ransomed soul!",
    ],
  },
  {
    title: "O Sacred Head, Now Wounded",
    author: "Bernard of Clairvaux (c.1090–1153), tr. James W. Alexander (1830)",
    verified: "Latin 12th c.; Alexander English 1830. PD.",
    slides: [
      "O sacred Head, now wounded,\nWith grief and shame weighed down,\nNow scornfully surrounded\nWith thorns, Thine only crown:\nO sacred Head, what glory,\nWhat bliss till now was Thine!\nYet, though despised and gory,\nI joy to call Thee mine.",
      "What Thou, my Lord, hast suffered\nWas all for sinners' gain;\nMine, mine was the transgression,\nBut Thine the deadly pain.\nLo, here I fall, my Savior!\n'Tis I deserve Thy place;\nLook on me with Thy favor,\nVouchsafe to me Thy grace.",
      "What language shall I borrow\nTo thank Thee, dearest friend,\nFor this Thy dying sorrow,\nThy pity without end?\nO make me Thine forever,\nAnd should I fainting be,\nLord, let me never, never\nOutlive my love to Thee.",
    ],
  },
  {
    title: "I Sing the Mighty Power of God",
    author: "Isaac Watts (1674–1748)",
    verified: "Text 1715. PD.",
    slides: [
      "I sing the mighty power of God\nThat made the mountains rise;\nThat spread the flowing seas abroad,\nAnd built the lofty skies.\nI sing the wisdom that ordained\nThe sun to rule the day;\nThe moon shines full at His command,\nAnd all the stars obey.",
      "I sing the goodness of the Lord,\nWho filled the earth with food;\nWho formed the creatures through the Word,\nAnd then pronounced them good.\nLord, how Thy wonders are displayed,\nWhere'er I turn my eye,\nIf I survey the ground I tread,\nOr gaze upon the sky!",
      "There's not a plant or flower below,\nBut makes Thy glories known;\nAnd clouds arise, and tempests blow,\nBy order from Thy throne;\nWhile all that borrows life from Thee\nIs ever in Thy care,\nAnd everywhere that man can be,\nThou, God, art present there.",
    ],
  },
  {
    title: "Trust and Obey",
    author: "John H. Sammis (1846–1919)",
    verified: "Text 1887. PD.",
    slides: [
      "When we walk with the Lord\nIn the light of His Word,\nWhat a glory He sheds on our way!\nWhile we do His good will,\nHe abides with us still,\nAnd with all who will trust and obey.",
      "Trust and obey, for there's no other way\nTo be happy in Jesus, but to trust and obey.",
      "Not a shadow can rise,\nNot a cloud in the skies,\nBut His smile quickly drives it away;\nNot a doubt or a fear,\nNot a sigh or a tear,\nCan abide while we trust and obey.",
      "But we never can prove\nThe delights of His love\nUntil all on the altar we lay;\nFor the favor He shows,\nAnd the joy He bestows,\nAre for them who will trust and obey.",
      "Then in fellowship sweet\nWe will sit at His feet,\nOr we'll walk by His side in the way;\nWhat He says we will do,\nWhere He sends we will go,\nNever fear, only trust and obey.",
    ],
  },
];

async function main() {
  const db = getDb();
  const [church] = await db.select().from(churches).limit(1);
  if (!church) { console.error("No church seeded yet. Run npm run db:seed first."); process.exit(1); }

  let added = 0;
  for (const h of HYMNS) {
    if (h.slides.length === 0) {
      console.log(`  · Skipping "${h.title}" — ${h.verified}`);
      continue;
    }
    // Idempotent + re-runnable: if the hymn already exists but our canonical
    // slide count has changed (we expanded a hymn's lyrics), replace its
    // slides in place. Preserves the song row + its id, so any playlist
    // items referencing it don't break.
    const [existing] = await db.select().from(songs).where(and(eq(songs.churchId, church.id), eq(songs.title, h.title), eq(songs.source, "public_domain"))).limit(1);
    if (existing) {
      const currentSlides = await db.select().from(songSlides).where(eq(songSlides.songId, existing.id));
      if (currentSlides.length === h.slides.length) {
        console.log(`  · Up-to-date: "${h.title}" (${currentSlides.length} slides)`);
        continue;
      }
      await db.delete(songSlides).where(eq(songSlides.songId, existing.id));
      await db.insert(songSlides).values(h.slides.map((lyrics, i) => ({ songId: existing.id, order: i, lyrics })));
      console.log(`  ↻ Refreshed "${h.title}" (${currentSlides.length} → ${h.slides.length} slides)`);
      continue;
    }

    const [song] = await db.insert(songs).values({ churchId: church.id, title: h.title, artist: h.author, source: "public_domain" }).returning();
    await db.insert(songSlides).values(h.slides.map((lyrics, i) => ({ songId: song.id, order: i, lyrics })));
    console.log(`  ✓ Added "${h.title}" (${h.slides.length} slides)`);
    added++;
  }
  console.log(`✓ Public domain hymns seed complete (${added} added)`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
